# Libraries kept with the app

These used to be loaded from a public CDN (cdn.jsdelivr.net). If that address was blocked or down, the 3D library failed to
load and the rest of the app stopped starting up with it. They are now served from the same place as the app itself.

- `three.min.js`: three.js r147 (https://github.com/mrdoob/three.js, tag r147), MIT licence, copyright the three.js authors.
- `mp4-muxer.js`: mp4-muxer 5.2.2 (https://github.com/Vanilagy/mp4-muxer, tag v5.2.2), MIT licence, copyright Vanilagy.

To update one, replace the file with the same build file from a newer tag and change its `?v=` in `index.html`.
