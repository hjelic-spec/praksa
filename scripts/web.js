// Web u uredu: poslužitelj dostupan s drugih računala u mreži (zadano port 8080).
//   npm run web
// Prvi put Windows može pitati za dopuštenje u vatrozidu: dopustite za privatne mreže.
process.env.PRAKSA_HOST ??= '0.0.0.0';
process.env.PORT ??= '8080';
const { start, allowedHostsFor } = await import('../src/server.js');
const { port } = await start();
console.log(`Preglednik sudske prakse – web u uredu (port ${port}). Otvorite u pregledniku na računalima u mreži:`);
for (const a of allowedHostsFor(port)) if (!a.startsWith('localhost') && !a.startsWith('127.')) console.log(`  http://${a}`);
console.log(`Na ovom računalu: http://localhost:${port}`);
