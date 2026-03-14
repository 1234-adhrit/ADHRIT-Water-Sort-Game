# Water Sort (Solo + Online Multiplayer)

A colorful water‑sort puzzle game with real‑time multiplayer, chat, levels, and custom difficulty. The server hosts the game at `http://localhost:3000/` and handles rooms, turns, and chat.

**How To Play**
1. Enter your name.
2. Choose Solo or Multiplayer.
3. In solo, sort each tube so it contains a single color.
4. In multiplayer, create a room or join one from the list. Only the current player can pour.
5. You can only pour **one layer** at a time onto the same color or an empty tube.

**Controls**
- `Undo` / `Redo` (solo only).
- `New Puzzle` / `Restart`.
- `Sound: On/Off`.
- Chat panel for multiplayer (timestamps toggle, typing indicator, mute).

**Levels & Difficulty**
- Use the Level buttons to play structured levels and unlock progress.
- Use the sliders for custom settings:
  - Colors
  - Tube capacity
  - Empty tubes

Progress and settings are saved in your browser.

## Run Locally
1. Open a terminal in this folder.
2. Start the server:
   ```bash
   npm.cmd install
   npm.cmd start

   ```
3. Open the game:
   ```
   http://localhost:3000/
   ```

**If you only open the HTML file**
- Open `index.html` in a browser.
- Set Multiplayer server URL to:
  ```
  ws://localhost:3000
  ```

## Multiplayer Rooms
- Click `Create Server` to generate a room code.
- Share the code or use the `Available Servers` list.
- The host starts the game.
- Rooms are limited to 2 players by default.

## Deploy To Render
Use a single **Web Service** so the server can serve both the game and WebSockets.

**Render Setup**
1. Create a new Web Service from your GitHub repo.
2. Build command:
   ```bash
   npm install
   ```
3. Start command:
   ```bash
   npm start
   ```
4. Render will set `PORT` automatically.

**Client URL**
- Open your Render app URL in the browser.
- Multiplayer auto‑uses the same host via `wss://`.

## Notes
- Real‑time chat is only enabled in multiplayer rooms.
- Undo/Redo is only available in solo mode.
- The server also supports listing available rooms.

## Play Online

- https://adhrit-watersort-online.onrender.com
