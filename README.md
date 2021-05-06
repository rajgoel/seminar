# Seminar

A [socket.io](https://socket.io/) platform for hosting seminars supporting multiple seminar rooms. To host a seminar room a password is required that is validated against a hash. Each room can be hosted by multiple hosts with one of the hosts being the chair.
Anyone with access to the room parameters (including the hash) can join the room. Hosts can send `announcements` and `messages` while other participants can only send `messages`. When the chair leaves a room, another host becomes the chair. When the last host leaves a room, the room is closed and all remaining participants are kicked out.

## Usage
```
npm install
npm run start
```

## License

MIT licensed

Copyright (C) 2021 Asvin Goel
