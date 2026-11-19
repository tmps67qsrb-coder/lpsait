# Подтверждение регистрации через Telegram

Регистрация создаёт временную заявку и открывает персональную ссылку `https://t.me/<bot_username>?start=<одноразовый-параметр>`. Telegram присылает параметр в `/start`; Netlify Function сверяет его с заявкой, подтверждает Telegram-аккаунт и сообщает сайту, что регистрацию можно завершить.

Для работы нужны сам Telegram-бот и уже используемый Netlify. Отдельный сервер или сервис не требуется.

Адрес сайта в Netlify: **https://lpsait.netlify.app**. Сейчас сайт отключён в Netlify, поэтому сначала включите его снова: откройте приложение `lpsait` → **Manage** → раздел **Disable, move, or delete** → **Enable**. Пока сайт отключён, страница регистрации и webhook недоступны.

## 1. Создайте бота

1. В Telegram откройте официальный `@BotFather` и выполните `/newbot`.
2. Задайте имя и username бота. Username должен оканчиваться на `bot`.
3. Сохраните токен BotFather. Не публикуйте и не отправляйте его в чат.

## 2. Добавьте переменные проекта Netlify

В Netlify откройте **Apps → lpsait → Manage → Keys and secrets**. Это настройки приложения, не командные настройки. Если вы видите **Team settings → Environment variables** и надпись о платном плане, вернитесь к приложению: общие переменные команды на бесплатном плане недоступны и здесь не нужны.

В настройках приложения добавьте переменные для **Production**, включив использование в **Functions**:

- `TELEGRAM_BOT_USERNAME` — username бота без `@`.
- `TELEGRAM_BOT_TOKEN` — новый токен от BotFather; отметьте как секрет. Если старый токен уже отправляли в переписку, сначала отзовите его через `@BotFather` и используйте новый.
- `TELEGRAM_WEBHOOK_SECRET` — отдельный случайный секрет из латинских букв, цифр, `_` и `-`, длиной 32–128 символов; отметьте как секрет. Его можно создать командой `openssl rand -hex 32`.
- `VOTE_SECRET` — оставьте существующее значение без изменений.

Не меняйте `VOTE_SECRET`: добавьте только Telegram-переменные и сохраните уже существующее значение `VOTE_SECRET`.

После сохранения переменных запустите новый production deploy и дождитесь успешного завершения.

## 3. Установите webhook Telegram

Webhook URL: **https://lpsait.netlify.app/api/telegram-webhook**.

После включения сайта и успешного production deploy выполните команду ниже в Терминале на своём компьютере. Она запросит токен и секрет скрытым вводом; не вставляйте их в переписку:

```sh
read -s "TELEGRAM_BOT_TOKEN?Токен BotFather: "
printf '\n'
read -s "TELEGRAM_WEBHOOK_SECRET?Секрет webhook: "
printf '\n'
curl --silent --show-error --fail-with-body --request POST \
  --data-urlencode "url=https://lpsait.netlify.app/api/telegram-webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
```

Успешный ответ Telegram содержит `"ok":true` и `"result":true`. Webhook проверяет секретный заголовок `X-Telegram-Bot-Api-Secret-Token`, установленный этим запросом.

## 4. Проверьте регистрацию

1. Откройте **https://lpsait.netlify.app** и начните регистрацию с отдельным тестовым номером.
2. Нажмите **Открыть Telegram-бот**, затем **Начать**.
3. Бот подтвердит приём, а сайт автоматически завершит регистрацию.

Ссылка действует 10 минут. Это подтверждает контроль Telegram-аккаунта, но не владение указанным номером телефона.

После успешной проверки Telegram-потока удалите из настроек приложения старые переменные `VK_COMMUNITY_SLUG`, `VK_COMMUNITY_ID`, `VK_CALLBACK_SECRET` и `VK_CONFIRMATION_TOKEN`, если они были заданы. Не удаляйте и не меняйте `VOTE_SECRET`.
