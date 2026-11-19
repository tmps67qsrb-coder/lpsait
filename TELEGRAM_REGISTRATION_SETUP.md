# Подтверждение регистрации через Telegram

Регистрация создаёт временную заявку и открывает персональную ссылку `https://t.me/<bot_username>?start=<одноразовый-параметр>`. Telegram присылает параметр в `/start`; Netlify Function сверяет его с заявкой, подтверждает Telegram-аккаунт и сообщает сайту, что регистрацию можно завершить.

Для работы нужны сам Telegram-бот и уже используемый Netlify. Отдельный сервер или сервис не требуется.

## 1. Создайте бота

1. В Telegram откройте официальный `@BotFather` и выполните `/newbot`.
2. Задайте имя и username бота. Username должен оканчиваться на `bot`.
3. Сохраните токен BotFather. Не публикуйте и не отправляйте его в чат.

## 2. Добавьте переменные Netlify

Откройте настройки конкретного приложения `lpsait` и найдите **Project configuration → Environment variables**. Создайте значения для **Production** и включите scope **Functions**:

- `TELEGRAM_BOT_USERNAME` — username бота без `@`.
- `TELEGRAM_BOT_TOKEN` — токен, полученный от BotFather; отметьте как секрет.
- `TELEGRAM_WEBHOOK_SECRET` — отдельный случайный секрет из латинских букв, цифр, `_` и `-`, длиной 32–128 символов; отметьте как секрет. Его можно создать командой `openssl rand -hex 32`.
- `VOTE_SECRET` — оставьте существующее значение без изменений.

Не добавляйте эти значения как общие переменные команды: на бесплатном тарифе они недоступны, а приложению нужны переменные с scope **Functions**.

После сохранения переменных запустите новый production deploy и дождитесь успешного завершения.

## 3. Установите webhook Telegram

Webhook URL: `https://<домен-сайта>/api/telegram-webhook`.

В терминале на своём компьютере выполните команду ниже, подставив домен production-сайта. Команда запросит токен и секрет скрытым вводом; не вставляйте их в переписку:

```sh
read -s "TELEGRAM_BOT_TOKEN?Токен BotFather: "
printf '\n'
read -s "TELEGRAM_WEBHOOK_SECRET?Секрет webhook: "
printf '\n'
curl --silent --show-error --fail-with-body --request POST \
  --data-urlencode "url=https://<домен-сайта>/api/telegram-webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
```

Успешный ответ Telegram содержит `"ok":true` и `"result":true`. Webhook проверяет секретный заголовок `X-Telegram-Bot-Api-Secret-Token`, установленный этим запросом.

## 4. Проверьте регистрацию

1. На production-сайте начните регистрацию с отдельным тестовым номером.
2. Нажмите **Открыть Telegram-бот**, затем **Начать**.
3. Бот подтвердит приём, а сайт автоматически завершит регистрацию.

Ссылка действует 10 минут. Это подтверждает контроль Telegram-аккаунта, но не владение указанным номером телефона.

После успешной проверки Telegram-потока удалите из настроек приложения старые переменные `VK_COMMUNITY_SLUG`, `VK_COMMUNITY_ID`, `VK_CALLBACK_SECRET` и `VK_CONFIRMATION_TOKEN`, если они были заданы. Не удаляйте и не меняйте `VOTE_SECRET`.
