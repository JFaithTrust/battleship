# RSSchool NodeJS websocket task template
> Static http server and base task packages. 
> By default WebSocket client tries to connect to the 3000 port.

## Installation
1. Clone/download repo
2. `npm install`

## Usage
**Development**

`npm run start:dev`

* App served @ `http://localhost:8181` with live TypeScript recompilation via `tsx`

**Production**

`npm run start`

* Builds TypeScript to `dist/` and serves @ `http://localhost:8181`

---

**All commands**

Command | Description
--- | ---
`npm run start:dev` | Start HTTP + WS servers with live TypeScript reload (`tsx watch`)
`npm run start` | Compile TypeScript then run the production build from `dist/`
`npm run build` | Compile TypeScript sources to `dist/`
`npm run lint` | Run ESLint with TypeScript rules
`npm run format` | Check code style with Prettier (no writes)
`npm run format:write` | Format sources with Prettier

**Note**: replace `npm` with `yarn` in `package.json` if you use yarn.
