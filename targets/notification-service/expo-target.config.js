// The Notification Service Extension that puts the sending bot's avatar on a notification
// (Communication Notifications). See docs/NOTIFICATION-AVATARS.md.
// Built by @bacons/apple-targets; its bundle id (com.brenw2.dorkbot.notification-service), App
// Group and Communication Notifications entitlement are also what eas credentials needs to sign it.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'notification-service',
  name: 'NotificationService',
  displayName: 'Dork Bot Notifications',
  bundleIdentifier: '.notification-service',
  deploymentTarget: '16.0',
  frameworks: ['UserNotifications', 'Intents'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
    'com.apple.developer.usernotifications.communication': true,
  },
});
