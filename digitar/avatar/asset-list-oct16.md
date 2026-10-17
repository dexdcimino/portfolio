DIGITAR AVATAR — ASSET LIST (what Bash needs from Dex, minimum)
Written Oct 16, 2026, after Bash inspected the WorldHop repos directly.

WHAT WE ALREADY HAVE (verified by Bash in the repos, Oct 16)
- Repo access: YES. Bash can read dexdcimino/worldhop + dexdcimino/worldhop-design.
- The character IS rigged. game/assets/character/ holds skeleton.glb,
  stickfigure.glb, stickfigure-blend.glb — all three skinned, 17-joint
  humanoid skeleton (Root, torso x2, Neck, Head, arms, legs). Body rig = DONE.
- The face is BLANK: zero morph targets / blendshapes in all three files.
  No mouth, no blink, no expressions exist yet.
- Design repo candidates to mine: Characters_Models/basic-eyes-blend1.fbx,
  blend_Test.fbx, skeleton_model.fbx, Cosmetics/basic_character.fbx.

NEEDED FROM DEX — the only things code cannot do
1. MOUTH SHAPES (starter set, 6): sculpted on the character's head, as
   blendshapes — A, E, I, O, U + mouth closed. These get him talking.
2. FACE SET (when ready, +9 = 15 total): blink, brow up, brow down,
   smile, frown, jaw open, squint, wide eyes, sad brows.
3. EYES ANSWER: are the eyes separate meshes? If yes, Bash needs NOTHING
   for eyes — big/small/squint/angry/sad/happy eyes are driven in code by
   scaling & moving the eye meshes. If the eyes are painted/merged into
   the head, the face set above grows.

NOT needed from Dex: body, rig, animations (procedural + code), textures,
the mouth-sprite plane (skipped per research — blendshapes win).

ONE DECISION: is the stick figure the avatar, or a placeholder for a
fuller character? Shapes sculpted on the wrong head = wasted work.

BASH'S SIDE (starting now): Unity project scaffold at
~/workspace/digitar-avatar/, model intake, MediaPipe tracking sidecar,
uLipSync lip-sync pipeline — so the day the mouth shapes land, he talks.
