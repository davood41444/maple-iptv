/*
 * Parental control: once a PIN is set in Settings, adult categories are
 * locked (shown with a lock) and their titles are left out of "All",
 * "Recently added" and search until the PIN is entered. Entering it unlocks
 * them until the app is closed.
 */
(function () {
  'use strict';
  const App = window.App;
  const t = App.t;
  const ADULT = /\b(adults?|xxx|porn\w*|sex\w*|erotic\w*)\b|18\s*\+|\+\s*18|بزرگسال/i;

  let unlocked = false;

  const parental = App.parental = {
    hasPin() {
      return !!App.settings.get('pin');
    },

    locked() {
      return parental.hasPin() && !unlocked;
    },

    isAdultGroup(name) {
      return ADULT.test(name || '');
    },

    isAdult(item) {
      return !!item.adult || parental.isAdultGroup(item.group);
    },

    // The list without adult items while locked.
    filter(list) {
      return parental.locked() ? list.filter(item => !parental.isAdult(item)) : list;
    },

    // Asks for the PIN if needed; resolves to true when adult content may be shown.
    async unlock() {
      if (!parental.locked()) return true;
      const pin = await App.ui.pin(t('pin.enter'));
      if (pin == null) return false;
      if (pin !== App.settings.get('pin')) {
        App.ui.toast(t('pin.wrong'), 'error');
        return false;
      }
      unlocked = true;
      return true;
    },

    // Settings: set, change or remove the PIN. Resolves once done.
    async manage() {
      if (parental.hasPin()) {
        const current = await App.ui.pin(t('pin.enterCurrent'));
        if (current == null) return;
        if (current !== App.settings.get('pin')) {
          App.ui.toast(t('pin.wrong'), 'error');
          return;
        }
        const choice = await App.ui.choose(t('pin.title'), [
          { value: 'change', label: t('pin.change') },
          { value: 'remove', label: t('pin.remove') },
        ]);
        if (choice === 'remove') {
          App.settings.set('pin', null);
          App.ui.toast(t('pin.removed'));
          return;
        }
        if (choice !== 'change') return;
      }
      const first = await App.ui.pin(t('pin.new'));
      if (first == null) return;
      const second = await App.ui.pin(t('pin.confirm'));
      if (second == null) return;
      if (first !== second) {
        App.ui.toast(t('pin.mismatch'), 'error');
        return;
      }
      App.settings.set('pin', first);
      unlocked = false;
      App.ui.toast(t('pin.saved'));
    },
  };
})();
