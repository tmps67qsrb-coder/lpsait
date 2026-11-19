# Подтверждение регистрации через Telegram

Регистрация создаёт временную заявку и открывает персональную ссылку `https://t.me/<bot_username>?start=<одноразовый-параметр>`. Telegram присылает параметр в `/start`; Netlify Function сверяет его с заявкой, подтверждает Telegram-аккаунт и сообщает сайту, что регистрацию можно завершить.

Для работы нужны сам Telegram-бот и уже используемый Netlify. Отдельный сервер или сервис не требуется.

Адрес сайта: **https://thebestproforg.netlify.app**. Для доставки событий Telegram сайт должен быть доступен из интернета без входа в Netlify. Если webhook отвечает HTTP 401, откройте Manage и найдите «Project visibility». Для работы бота требуется значение Public.

## 1. Создайте бота

1. В Telegram откройте официальный `@BotFather` и выполните `/newbot`.
2. Задайте имя и username бота. Username должен оканчиваться на `bot`.
3. Сохраните токен BotFather. Не публикуйте и не отправляйте его в чат.

## 2. Добавьте переменные проекта Netlify

Откройте Manage и найдите «Environment variables».

В настройках приложения добавьте переменные для **Production**, включив использование в **Functions**:

- `TELEGRAM_BOT_USERNAME` — username бота без `@`.
- `TELEGRAM_BOT_TOKEN` — новый токен от BotFather; отметьте как секрет. Если старый токен уже отправляли в переписку, сначала отзовите его через `@BotFather` и используйте новый.
- `TELEGRAM_WEBHOOK_SECRET` — отдельный случайный секрет из латинских букв, цифр, `_` и `-`, длиной 32–128 символов; отметьте как секрет. Его можно создать командой `openssl rand -hex 32`.
- `VOTE_SECRET` — ключ шифрования данных и подписи сессий, не менее 32 байт. Если пользователи уже регистрировались, восстановите прежнее значение. Для нового сайта без сохранённых данных создайте криптографически случайный ключ.

Не заменяйте существующий `VOTE_SECRET`: смена ключа делает ранее зашифрованные данные недоступными и завершает действующие сессии.

После сохранения переменных запустите новый production deploy и дождитесь успешного завершения.

## 3. Установите webhook Telegram

Webhook URL: **https://thebestproforg.netlify.app/api/telegram-webhook**.

После включения сайта и успешного production deploy выполните команду ниже в Терминале на своём компьютере. Она запросит токен и секрет скрытым вводом; не вставляйте их в переписку:

```sh
read -s "TELEGRAM_BOT_TOKEN?Токен BotFather: "
printf '\n'
read -s "TELEGRAM_WEBHOOK_SECRET?Секрет webhook: "
printf '\n'
curl --silent --show-error --fail-with-body --request POST \
  --data-urlencode "url=https://thebestproforg.netlify.app/api/telegram-webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
```

Успешный ответ Telegram содержит `"ok":true` и `"result":true`. Webhook проверяет секретный заголовок `X-Telegram-Bot-Api-Secret-Token`, установленный этим запросом.

## 4. Проверьте регистрацию

1. Откройте **https://thebestproforg.netlify.app** и начните регистрацию с отдельным тестовым номером.
2. Нажмите **Открыть Telegram-бот**, затем **Начать**.
3. Бот подтвердит приём, а сайт автоматически завершит регистрацию.

Ссылка действует 10 минут. Это подтверждает контроль Telegram-аккаунта, но не владение указанным номером телефона.

После успешной проверки Telegram-потока удалите из настроек приложения старые переменные `VK_COMMUNITY_SLUG`, `VK_COMMUNITY_ID`, `VK_CALLBACK_SECRET` и `VK_CONFIRMATION_TOKEN`, если они были заданы. Не удаляйте и не меняйте `VOTE_SECRET`.
