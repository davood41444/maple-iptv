import StoreKit

/// App Store subscription: "monthly" and "yearly" auto-renewable subscriptions (productIds)
/// in one subscription group, set up in App Store Connect. Reports prices and whether a
/// subscription is active to the page as "billing" events, like the Android app's Google
/// Play Billing (web/js/premium.js).
@MainActor
final class Billing {
    static let productIds = ["monthly": "maple_premium_monthly", "yearly": "maple_premium_yearly"]

    private let emit: ([String: Any]) -> Void
    private var products: [String: Product] = [:]
    private var updates: Task<Void, Never>?

    init(emit: @escaping ([String: Any]) -> Void) {
        self.emit = emit
        // Renewals, refunds, and purchases finished elsewhere (another device, Ask to Buy).
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result { await transaction.finish() }
                await self?.refresh()
            }
        }
    }

    func start() {
        Task {
            await loadPlans()
            await refresh()
        }
    }

    func buy(_ plan: String) {
        guard let product = products[plan] else {
            send("error", ["message": "Plan \(plan) is not available"])
            return
        }
        Task {
            do {
                switch try await product.purchase() {
                case .success(let result):
                    if case .verified(let transaction) = result { await transaction.finish() }
                    await refresh()
                case .userCancelled:
                    send("cancelled", [:])
                case .pending:
                    break // waits for approval (Ask to Buy); Transaction.updates brings the result
                @unknown default:
                    break
                }
            } catch {
                send("error", ["message": error.localizedDescription])
            }
        }
    }

    /// "Restore purchases" (App Store rules ask for it): syncs this Apple ID's purchases.
    func restore() {
        Task {
            try? await AppStore.sync()
            await refresh()
        }
    }

    private func loadPlans() async {
        do {
            let found = try await Product.products(for: Array(Self.productIds.values))
            var plans: [[String: Any]] = []
            products = [:]
            for (plan, id) in Self.productIds {
                guard let product = found.first(where: { $0.id == id }) else { continue }
                products[plan] = product
                plans.append(["id": plan, "price": product.displayPrice, "period": period(product)])
            }
            if plans.isEmpty {
                send("unavailable", [:])
            } else {
                send("plans", ["plans": plans])
            }
        } catch {
            send("unavailable", ["message": error.localizedDescription])
        }
    }

    private func refresh() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  Self.productIds.values.contains(transaction.productID),
                  transaction.revocationDate == nil else { continue }
            if (transaction.expirationDate ?? .distantFuture) > Date() { active = true }
        }
        send("status", ["active": active])
    }

    // ISO 8601 like Google Play's billing period: P1M, P1Y.
    private func period(_ product: Product) -> String {
        guard let period = product.subscription?.subscriptionPeriod else { return "" }
        switch period.unit {
        case .day: return "P\(period.value)D"
        case .week: return "P\(period.value)W"
        case .month: return "P\(period.value)M"
        case .year: return "P\(period.value)Y"
        @unknown default: return ""
        }
    }

    private func send(_ name: String, _ fields: [String: Any]) {
        var event = fields
        event["type"] = "billing"
        event["event"] = name
        emit(event)
    }
}
