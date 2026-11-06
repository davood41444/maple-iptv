package com.mapleonlinesolutions.iptv

import android.app.Activity
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/**
 * Google Play subscription: one product (PRODUCT_ID) with "monthly" and
 * "yearly" base plans, set up in Play Console. Reports prices and whether a
 * subscription is active to the page as "billing" events (see web/js/premium.js).
 */
class Billing(private val activity: Activity, private val emit: (JSONObject) -> Unit) : PurchasesUpdatedListener {
    private val client = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private var product: ProductDetails? = null

    fun start() {
        if (client.isReady) {
            loadPlans()
            refresh()
            return
        }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                val subscriptions = client.isFeatureSupported(BillingClient.FeatureType.SUBSCRIPTIONS)
                if (result.responseCode == BillingClient.BillingResponseCode.OK &&
                    subscriptions.responseCode == BillingClient.BillingResponseCode.OK
                ) {
                    loadPlans()
                    refresh()
                } else {
                    emit(event("unavailable").put("code", result.responseCode))
                }
            }

            override fun onBillingServiceDisconnected() {
                // The client reconnects by itself (enableAutoServiceReconnection).
            }
        })
    }

    /** Checks for an active subscription again, e.g. when the app comes back to the front. */
    fun refresh() {
        if (!client.isReady) return
        val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
        client.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) handle(purchases)
        }
    }

    fun buy(planId: String) {
        val product = product
        val offer = product?.subscriptionOfferDetails?.firstOrNull { it.basePlanId == planId && it.offerId == null }
        if (product == null || offer == null) {
            emit(event("error").put("message", "Plan $planId is not available"))
            return
        }
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(product)
                        .setOfferToken(offer.offerToken)
                        .build(),
                ),
            )
            .build()
        client.launchBillingFlow(activity, params)
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> handle(purchases.orEmpty())
            BillingClient.BillingResponseCode.USER_CANCELED -> emit(event("cancelled"))
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> refresh()
            else -> emit(event("error").put("message", result.debugMessage).put("code", result.responseCode))
        }
    }

    private fun loadPlans() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ),
            )
            .build()
        client.queryProductDetailsAsync(params) { result, details ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                emit(event("unavailable").put("code", result.responseCode))
                return@queryProductDetailsAsync
            }
            val found = details.productDetailsList.firstOrNull()
            product = found
            val plans = JSONArray()
            found?.subscriptionOfferDetails?.filter { it.offerId == null }?.forEach { offer ->
                val phase = offer.pricingPhases.pricingPhaseList.lastOrNull() ?: return@forEach
                plans.put(JSONObject().put("id", offer.basePlanId).put("price", phase.formattedPrice).put("period", phase.billingPeriod))
            }
            emit(event("plans").put("plans", plans))
        }
    }

    // Initial subscription purchases must be acknowledged within three days or Google refunds them.
    private fun handle(purchases: List<Purchase>) {
        val active = purchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
        active.filter { !it.isAcknowledged }.forEach { purchase ->
            val params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
            client.acknowledgePurchase(params) { }
        }
        emit(event("status").put("active", active.isNotEmpty()))
    }

    private fun event(name: String) = JSONObject().put("type", "billing").put("event", name)

    companion object {
        const val PRODUCT_ID = "maple_premium"
    }
}
