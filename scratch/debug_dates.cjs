const { isSameDay, addDays } = require('date-fns');

// Mock data based on the screenshot
// Let's assume the user's due_date is what we think it is.
// Actually, let's just write a test with a few dates.
const d1 = new Date('2026-07-18T12:00:00Z');
const d2 = new Date('2026-07-18T23:59:59Z');
const d3 = new Date('2026-07-18');

console.log("d1 local:", d1.toString());
console.log("d2 local:", d2.toString());
console.log("d3 local:", d3.toString());

const earliest = new Date(Math.min(d1.getTime(), d2.getTime(), d3.getTime()));
console.log("earliest local:", earliest.toString());

for (let j = 0; j < 7; j++) {
  const day = addDays(earliest, j);
  console.log(`Day ${j} (${day.toString()}):`);
  console.log(`  isSameDay(d1, day)? ${isSameDay(d1, day)}`);
  console.log(`  isSameDay(d2, day)? ${isSameDay(d2, day)}`);
  console.log(`  isSameDay(d3, day)? ${isSameDay(d3, day)}`);
}
