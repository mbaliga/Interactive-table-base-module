import { createTable } from './kit';
import { demoBackground } from './demo/background';
import { demoScenes } from './demo/scenes';

/* The app. For a new table app, replace the demo scenes and background with your own (docs/NEW-APP.md), keep the kit. */
createTable({
  scenes: demoScenes,
  background: demoBackground,
  attract: { subtitle: 'or touch the table · scan the code to play on your phone' },
});
