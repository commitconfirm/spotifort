// 404 page: show a random quote (no imports; this page does not load the app)

const asimovQuotes = [
  "The saddest aspect of life right now is that science gathers knowledge faster than society gathers wisdom.",
  "I do not fear computers. I fear the lack of them.",
  "Part of the inhumanity of the computer is that, once it is competently programmed and working smoothly, it is completely honest.",
  "The most exciting phrase to hear in science, the one that heralds new discoveries, is not 'Eureka!' but 'That's funny...'",
  "Self-education is, I firmly believe, the only kind of education there is.",
  "If my doctor told me I had only six minutes to live, I wouldn't brood. I'd type a little faster.",
  "Any sufficiently advanced technology is indistinguishable from magic... wait, that's Clarke. BEEP BOOP. ERROR.",
  "It is change, continuing change, inevitable change, that is the dominant factor in society today.",
  "Violence is the last refuge of the incompetent.",
  "The true delight is in the finding out rather than in the knowing.",
  "I'm not a speed reader. I'm a speed understander.",
  "Life is pleasant. Death is peaceful. It's the transition that's troublesome."
];

const quote = asimovQuotes[Math.floor(Math.random() * asimovQuotes.length)];
const target = document.getElementById('asimov-quote');
if (target) {
  const em = document.createElement('em');
  em.textContent = `"${quote}"`;
  target.append(em, ' — Isaac Asimov');
}
