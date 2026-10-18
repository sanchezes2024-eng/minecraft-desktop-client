# Voxel Desktop Client

A fullscreen Electron desktop client prototype using Mineflayer and Prismarine Viewer.

## Install and run

Requirements: Node.js and npm.

```bash
npm install
npm install canvas
npm start
```

If you have an existing checkout, get the latest source with `git pull` before installing.

## Controls

- W/A/S/D or arrow keys: move
- Space: jump
- Shift: sneak
- Ctrl: sprint
- Mouse: look around while captured
- 1–9 or mouse wheel: select hotbar slot
- Left click: attack a mob under the crosshair, or attempt to break the targeted block
- Right click: attempt to place the held block
- T: open chat
- Escape: pause menu / resume

## Notes

This is a Mineflayer-driven client prototype, not a full reimplementation of the official Minecraft client. The server controls permissions and game mode. Protocol support and world rendering depend on the installed Mineflayer and Prismarine Viewer versions. Creative-mode inventory management, full crafting screens, resource packs, sound, and complete parity with the official client are not implemented.

## Minecraft Java 26.3 compatibility

The standard PrismarineJS Mineflayer release may not include protocol data for Minecraft Java 26.3. This build uses the third-party `@wp2508/mineflayer` fork through an npm alias so existing `require('mineflayer')` code continues to work. The fork advertises 26.3 support, but compatibility with every server and the viewer is not guaranteed or independently verified.

If dependency installation or connection fails, share the complete error log. Do not enter your Microsoft password into this app; use only a trusted supported sign-in flow.