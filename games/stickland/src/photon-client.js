// ══════════════════════════════════════
//  DexNote — PHOTON CLIENT
//  Photon Realtime networking for play mode multiplayer.
//  Same architecture as NodeBlast's photon-client.js.
// ══════════════════════════════════════

const PHOTON_APP_ID = 'ff6d154a-33f9-480a-bb99-eeccfde3b012';
const PHOTON_APP_VERSION = '1.0';
const SEND_RATE_MS = 50;
const MAX_PLAYERS_PER_ROOM = 8;

let _client = null;
let _myId = null;
let _connected = false;
let _inRoom = false;
let _roomName = 'dexnote-freeplay';
let _onPlayerUpdate = null;
let _onPlayerLeave = null;
let _onConnected = null;
let _onPlayerDamage = null;
let _onTankUpdate = null;
let _onProjectileFired = null;
let _sendTimer = null;

export function setPhotonStatus(msg) {
  const el = document.getElementById('play-status');
  if (!el) return;
  const hud = document.getElementById('play-connection-hud');
  // Empty status → fully hide the HUD. Solo players should see nothing at all.
  if (!msg) {
    el.textContent = '';
    if (hud) hud.style.display = 'none';
    return;
  }
  el.textContent = msg;
  el.style.cssText = 'background:rgba(0,0,0,0.55);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;pointer-events:none;white-space:nowrap;';
  if (hud) hud.style.display = 'flex';
}

/**
 * Initialize and connect to Photon.
 * @param {object} opts
 * @param {string} opts.roomName
 * @param {function} opts.onPlayerUpdate - (actorNr, x, y, animState, phase, flipX, weapon, username, hex, appearance)
 * @param {function} opts.onPlayerLeave - (actorNr)
 * @param {function} opts.onConnected - (myActorNr)
 * @param {function} opts.onPlayerDamage - (targetId, damage, attackerName)
 */
export function initPhoton({ roomName, onPlayerUpdate, onPlayerLeave, onConnected, onPlayerDamage, onTankUpdate, onProjectileFired }) {
  const P = window.Photon;
  if (!P) throw new Error('Photon SDK not loaded — ensure photon-realtime-module.js is in the project root');

  _roomName = roomName || 'dexnote-freeplay';
  _onPlayerUpdate    = onPlayerUpdate    || null;
  _onPlayerLeave     = onPlayerLeave     || null;
  _onConnected       = onConnected       || null;
  _onPlayerDamage    = onPlayerDamage    || null;
  _onTankUpdate      = onTankUpdate      || null;
  _onProjectileFired = onProjectileFired || null;

  _client = new P.LoadBalancing.LoadBalancingClient(
    P.ConnectionProtocol.Wss,
    PHOTON_APP_ID,
    PHOTON_APP_VERSION,
  );

  _client.onStateChange = (state) => {
    const name = P.LoadBalancing.LoadBalancingClient.StateToName(state);
    console.log('[photon] state:', state, name);

    if (name === 'ConnectedToMaster') {
      _connected = true;
      // Transient status suppressed — solo player shouldn't see "joining lobby..."
    }

    if (name === 'JoinedLobby') {
      // Transient status suppressed — solo player shouldn't see "finding room..."
      _client.joinRoom(_roomName);
    }

    if (name === 'Joined') {
      if (_inRoom) return;
      _inRoom = true;
      _myId = _client.myActor().actorNr;
      window._dexMyPhotonId = _myId;
      console.log('[photon] in room "' + _roomName + '", my actor:', _myId);
      _updatePlayerCount();
      if (_onConnected) _onConnected(_myId);
      _startSendLoop();
    }

    if (name === 'Error' || name === 'Disconnected') {
      // Only show "offline" if there was someone in the room with us — the player
      // cares when co-op drops out, not when solo mode fails to find anyone.
      try {
        const others = (_client.myRoomActorsCount?.() || 1) - 1;
        if (others > 0) setPhotonStatus('offline'); else setPhotonStatus('');
      } catch { setPhotonStatus(''); }
      _inRoom = false;
    }
  };

  _client.onActorLeave = (actor) => {
    if (_onPlayerLeave) _onPlayerLeave(actor.actorNr);
    _updatePlayerCount();
  };

  _client.onActorJoin = () => {
    _updatePlayerCount();
  };

  // Event code 1: position/animation, 2: damage, 3: tank, 4: projectile
  _client.onEvent = (code, content, actorNr) => {
    if (code === 1 && actorNr !== _myId && _onPlayerUpdate) {
      _onPlayerUpdate(
        actorNr,
        content.x, content.y,
        content.animState, content.phase, content.flipX,
        content.weapon,
        content.username, content.hex,
        content.appearance || null,
        { vy: content.vy||0, chargeT: content.chargeT||0, stunSev: content.stunSev||0, hoverboard: content.hoverboard||false }
      );
    }
    if (code === 2 && _onPlayerDamage) {
      _onPlayerDamage(content.targetId, content.damage, content.attackerName);
    }
    if (code === 3 && actorNr !== _myId && _onTankUpdate) {
      _onTankUpdate(actorNr, content.inTank, content.tankX, content.tankY, content.tankAngle);
    }
    if (code === 4 && actorNr !== _myId && _onProjectileFired) {
      _onProjectileFired(actorNr, content.x, content.y, content.vx, content.vy, content.type);
    }
  };

  _client.onOperationResponse = (errorCode, errorMsg, operationCode, content) => {
    if (operationCode === 226 && errorCode) {
      console.log('[photon] joinRoom failed (' + errorCode + ': ' + errorMsg + '), creating room "' + _roomName + '"');
      _client.createRoom(_roomName, { maxPlayers: MAX_PLAYERS_PER_ROOM });
    }
  };

  _client.onError = (errorCode, errorMsg) => {
    console.warn('[photon] error:', errorCode, errorMsg);
    // Only surface "offline" if there are others in the room who rely on the connection
    try {
      const others = (_client.myRoomActorsCount?.() || 1) - 1;
      if (others > 0) setPhotonStatus('offline');
    } catch {}
  };

  // Transient "connecting..." status suppressed — no feedback until someone else
  // is actually in the room with us.
  _client.connectToRegionMaster('us');
}

// Auto-hide the HUD 4s after the last count change so the player isn't reminded
// they have company indefinitely.
let _hudHideTimer = null;
function _updatePlayerCount() {
  if (!_client) return;
  try {
    const count = _client.myRoomActorsCount();
    const others = count - 1;
    console.log('[mp] room count:', count);
    if (others <= 0) {
      // Solo — hide HUD entirely, no status for a solo player
      setPhotonStatus('');
      clearTimeout(_hudHideTimer);
      return;
    }
    setPhotonStatus(others + (others === 1 ? ' player' : ' players') + ' nearby');
    clearTimeout(_hudHideTimer);
    _hudHideTimer = setTimeout(() => setPhotonStatus(''), 4000);
  } catch {}
}

export function photonSendState(x, y, animState, phase, flipX, weapon, username, hex, appearance, extra) {
  if (!_inRoom || !_client) return;
  const data = { x, y, animState, phase, flipX, weapon, username, hex };
  if (appearance) data.appearance = appearance;
  if (extra) { data.vy = extra.vy; data.chargeT = extra.chargeT; data.stunSev = extra.stunSev; data.hoverboard = extra.hoverboard; }
  _client.raiseEvent(1, data);
}

export function photonSendDamage(targetActorId, damage, attackerName) {
  if (!_inRoom || !_client) return;
  const P = window.Photon;
  _client.raiseEvent(2,
    { targetId: targetActorId, damage, attackerName },
    { receivers: P.LoadBalancing.Constants.ReceiverGroup.All }
  );
}

export function photonSendTankState(inTank, tankX, tankY, tankAngle) {
  if (!_inRoom || !_client) return;
  _client.raiseEvent(3, { inTank, tankX, tankY, tankAngle });
}

export function photonSendProjectile(x, y, vx, vy, type) {
  if (!_inRoom || !_client) return;
  _client.raiseEvent(4, { x, y, vx, vy, type: type || 'arrow' });
}

function _startSendLoop() {
  if (_sendTimer) clearInterval(_sendTimer);
  let _sendCount = 0;
  _sendTimer = setInterval(() => {
    if (!window._dexGetPlayState) return;
    const s = window._dexGetPlayState();
    if (!s) return;
    const appearance = (_sendCount === 0 || _sendCount % 60 === 0)
      ? (window._dexGetAppearance?.() || null)
      : null;
    _sendCount++;
    if (window._dexHathoraConnected?.()) {
      window._dexHathoraSendMove?.(s.x, s.y, s.animState, s.phase, s.flipX);
    }
    photonSendState(s.x, s.y, s.animState, s.phase, s.flipX, s.weapon, s.username, s.hex, appearance, { vy: s.vy, chargeT: s.chargeT, stunSev: s.stunSev, hoverboard: s.hoverboard });
    const tank = window._dexGetTankState?.();
    if (tank) photonSendTankState(tank.inTank, tank.tankX, tank.tankY, tank.tankAngle);
  }, SEND_RATE_MS);
}

export function photonChangeRoom(newRoomName) {
  if (!_client || !_inRoom) return;
  _roomName = newRoomName || 'dexnote-freeplay';
  _inRoom = false;
  _client.leaveRoom();
}

export function destroyPhoton() {
  if (_sendTimer) { clearInterval(_sendTimer); _sendTimer = null; }
  if (_client) {
    try { _client.disconnect(); } catch {}
    _client = null;
  }
  _connected = false;
  _inRoom    = false;
  _myId      = null;
  _onPlayerUpdate    = null;
  _onPlayerLeave     = null;
  _onConnected       = null;
  _onPlayerDamage    = null;
  _onTankUpdate      = null;
  _onProjectileFired = null;
}

export function photonIsConnected() { return _connected && _inRoom; }
export function photonGetMyId() { return _myId; }
export function photonGetPlayerCount() {
  if (!_client) return 0;
  try { return _client.myRoomActorsCount(); } catch { return 0; }
}
