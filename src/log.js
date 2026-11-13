// Logging: verbose in development, silent in production except for errors. Its own module so that any module can
// import it without a cycle through main.js.
export const log = {
  info: (...args) => import.meta.env.DEV && console.log('[spotifort]', ...args),
  warn: (...args) => import.meta.env.DEV && console.warn('[spotifort]', ...args),
  error: (...args) => console.error('[spotifort]', ...args), // errors always log
};
