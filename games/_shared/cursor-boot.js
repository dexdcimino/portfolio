// One-line boot for games that take the site's accent cursor: loaded as the
// LAST module in the page, so the game's own accent code has already
// published --accent by the time the cursors are drawn from it.
import { installAccentCursor } from './cursor.js';
installAccentCursor();
