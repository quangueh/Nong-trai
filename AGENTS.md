# Nông trại — agent notes

## Deploy

- Frontend: `npm run build` (typecheck + vite build).
- Worker (account/social/leaderboard/room): `npm run deploy:worker` —
  `wrangler deploy` trong `worker/`. **Mọi thay đổi trong `worker/src/` phải
  chạy lệnh này sau khi commit**, không thì code mới không lên production.
  Wrangler đã login bằng OAuth của tài khoản quangfortask@gmail.com.
