# OfficeCraft

A block-building survival game in the browser: dig, build and survive the night.

**Play:** https://juha-rajamaki.github.io/officecraft/

## Features

- Four connected maps: Green Hills, Flatlands, Archipelago and Desert, joined by bridges across the sea
- Press **M** for a map of all four, showing where you are and your respawn point
- Caves, ores, villages and ruined towers
- Day/night cycle, Mosslings by day and the Gloom at night
- Sound effects and ambience, all synthesised in the browser
- Block hardness: dirt is quick, stone and ore take longer
- Tools: pickaxe for stone and ore, axe for wood, shovel for dirt and sand, in stone, iron and diamond tiers
- Ores: coal, iron, and deep underground gold and diamond (these need an iron pickaxe)
- Crafting: torches, lamps, chests, doors, ladders, beds, tools, armor and golden apples
- Hunger: eat apples (they drop from leaves) to keep healing; an empty stomach starts to hurt
- Beds set your respawn point and let you sleep through the night; armor blocks part of the damage
- Saving: the world autosaves in your browser (IndexedDB), and Export/Import moves a save between devices

## Credits

Built by **Leevi**, improved by **borre**.

## Development

```sh
npm install
npm run dev     # local dev server on http://localhost:5180
npm run build   # builds into docs/ (served by GitHub Pages)
```
