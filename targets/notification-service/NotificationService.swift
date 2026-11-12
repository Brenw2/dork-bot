// Notification Service Extension: shows the bot's avatar next to its notification.
//
// The plugin sends every push with mutableContent, so iOS runs this before showing it. We donate an
// INSendMessageIntent with the bot as the sender (INPerson + INImage) and let iOS rebuild the
// notification from it (Communication Notifications): the bot's picture on the left, a small Dork Bot
// badge on it, like Messages. docs/NOTIFICATION-AVATARS.md has the whole picture.
//
// No network here. The app renders each bot's sprite to a PNG whenever its look changes (lib/avatar.ts
// via components/avatars.ts) and stores it, base64, in the App Group's shared UserDefaults under
// "avatar.<profile id>". Whatever goes wrong (no avatar yet, bad data, the intent fails, the extension
// runs out of time) the push is shown as the plugin sent it. A push is never dropped.
import Intents
import UserNotifications

private let appGroup = "group.com.brenw2.dorkbot"

class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    self.original = request.content
    contentHandler(withAvatar(request.content) ?? request.content)
    self.contentHandler = nil
  }

  // iOS is about to cut us off (about 30 s): show the push as it is.
  override func serviceExtensionTimeWillExpire() {
    if let handler = contentHandler, let original = original {
      handler(original)
      contentHandler = nil
    }
  }

  /// The push rebuilt as a message from the bot, or nil to show it unchanged.
  private func withAvatar(_ content: UNNotificationContent) -> UNNotificationContent? {
    let info = content.userInfo
    // Expo puts the push's `data` under "body" (expo-notifications reads it the same way).
    var data: [String: Any] = [:]
    if let object = info["body"] as? [String: Any] {
      data = object
    } else if let text = info["body"] as? String, let raw = text.data(using: .utf8),
      let object = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any]
    {
      data = object
    }
    guard let bot = data["bot"] as? String, !bot.isEmpty else { return nil }
    guard
      let defaults = UserDefaults(suiteName: appGroup),
      let encoded = defaults.string(forKey: "avatar.\(bot)"),
      let png = Data(base64Encoded: encoded),
      !png.isEmpty
    else { return nil }

    let name = (data["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? bot
    var body = content.body
    // A routine's title is "<name> · <routine>"; the sender line only has room for the name.
    if let job = content.title.components(separatedBy: " · ").dropFirst().first, content.title.hasPrefix(name + " · ") {
      body = "\(job): \(body)"
    }

    let sender = INPerson(
      personHandle: INPersonHandle(value: bot, type: .unknown),
      nameComponents: nil,
      displayName: name,
      image: INImage(imageData: png),
      contactIdentifier: nil,
      customIdentifier: bot,
      isMe: false,
      suggestionType: .none
    )
    let chat = (data["chat"] as? String) ?? bot
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: body,
      speakableGroupName: nil,
      conversationIdentifier: chat,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate(completion: nil)

    do {
      return try content.updating(from: intent)
    } catch {
      return nil
    }
  }
}
