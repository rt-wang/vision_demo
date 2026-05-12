Create an interactive desktop-style computer vision demo where the **webcam is the main visual focus**, displayed in a large independent-feeling window or floating panel rather than a traditional webpage layout.

The demo should use OpenCV.js and real-time webcam input to switch between four visual modes using floating buttons:

1. Line Detection

* Use edge detection and Hough Line Transform.
* Overlay detected straight lines directly on the webcam feed.
* Make the result feel like a live creative-coding visual effect.

2. Depth Map

* Generate a pseudo-depth map or integrate a lightweight browser-compatible depth estimation model if needed.
* Display the depth effect as a stylized overlay on the webcam feed.

3. Object Detection

* Detect common objects in real time.
* Draw bounding boxes and labels directly over the webcam image.
* Use a lightweight model such as COCO-SSD, YOLO, or MediaPipe if OpenCV alone is not enough.

4. Segmentation

* Segment people or foreground/background regions.
* Show the segmentation mask as an overlay on top of the webcam feed.

UI/UX requirements:

* The webcam view should fill most of the screen.
* Use floating buttons over or beside the webcam feed to switch between modes.
* Avoid a standard webpage layout with side panels.
* Make it feel like an independent creative tool window, similar to a lightweight TouchDesigner / Runway-style visual interface.
* Use a dark, minimal, immersive aesthetic.
* Current mode should be clearly highlighted.
* Keep controls minimal and non-intrusive.

Technical requirements:

* Use JavaScript or TypeScript.
* Run fully in the browser.
* Use OpenCV.js for computer vision processing where appropriate.
* Use HTML5 Canvas or WebGL for rendering overlays.
* Access the webcam using `getUserMedia`.
* Keep each visual mode modular and easy to extend.
* Maintain smooth real-time performance.
* Add clear comments explaining the important OpenCV/model-processing logic.

The final demo should feel like a real-time webcam-based computer vision playground, not a static website or tutorial page.

