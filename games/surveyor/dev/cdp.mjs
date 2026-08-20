// MOVED. The CDP client is shared by all four games now — it never had
// anything Surveyor-specific in it, and a second copy is a second place to
// forget the Downloads note it carries. This file stays so that the twenty
// harnesses beside it keep importing './cdp.mjs' unchanged.
//
// The real thing: games/_shared/dev/cdp.mjs
export * from '../../_shared/dev/cdp.mjs';
