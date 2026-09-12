# TAIMIO Key Service

Cloudflare Worker + D1 для 15 онлайн-ключей TAIMIO Beta. Три офлайн-ключа сюда не заносятся.

## Локально

```bash
cd key-service
npm install
npm run issue
npm run d1:init
npm run d1:seed
npm run dev
```

Админка: `http://127.0.0.1:8787/admin`

Для приложения:

```
TAIMIO_KEY_SERVICE_URL=http://127.0.0.1:8787
```

## Прод

```bash
wrangler d1 create taimio-keys
```

Подставьте `database_id` в `wrangler.toml`, затем:

```bash
wrangler secret put SIGNING_PRIVATE_B64
wrangler secret put ACCESS_PEPPER
wrangler secret put ADMIN_TOKEN
wrangler d1 execute taimio-keys --remote --file=schema.sql
wrangler d1 execute taimio-keys --remote --file=issued/seed.sql
wrangler deploy
```

После деплоя пропишите URL воркера в `src/shared/accessConfig.ts`.

Полные ключи только в `issued/KEYS.txt`. Папку `issued/` и секреты не коммитить.
