# Seminar

A [socket.io](https://socket.io/) platform for hosting seminars supporting multiple seminar rooms. To host a seminar room a password is required that is validated against a hash. Each room can be hosted by multiple hosts with one of the hosts being the chair.
Anyone with access to the room parameters (including the hash) can join the room. Hosts can send `announcements` and `messages` while other participants can only send `messages`. When the chair leaves a room, another host becomes the chair. When the last host leaves a room, the room is closed and all remaining participants are kicked out.

## Usage
```
npm install
npm run start
```

## Http and Https

By default an http server is started:
```
node server.js
```

If the path to a key and certificate are provided, an https server is started:

```
node server.js <path_to_key.pem> <path_to_cert.pem>
```

The key and certificate can be obtained, e.g., by following the instructions on https://certbot.eff.org/instructions.

Make sure to ensure that certificates are renewed when necessary, e.g. by adding a cronjob. When using automatic renewal, the server may have to be restarted.

## License

MIT licensed

Copyright (C) 2022 Asvin Goel
