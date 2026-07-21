# oai-hw-2026

## Mimetry — V1

Mimetry is a browser-based practice instrument for ear training in context. It sustains a living tonal drone, listens for one sung or played note at a time, and visualizes the relationship between that note and the tonal center. Learners can save the descriptors that feel true to them, building a personal vocabulary for musical tension and resolution.

### Run locally

This V1 has no build step or external dependencies. Serve the repository from a local web server, then open the displayed URL in a modern browser:

```bash
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173). Click **hold home** to start the drone, then choose **enable listening** to grant microphone access. Headphones are recommended so the microphone does not hear the drone itself.

### V1 capabilities

- Additive, gently modulated drone synthesis with adjustable tonal center, register, character, and level.
- Local, real-time monophonic microphone pitch tracking.
- A Mimetry visual that distinguishes stable intervals from tension.
- A personal, persistent descriptor stream: select words that match how an interval lands for you.
- An optional mirrored camera practice view with a three-second fist hold for Cue Mode. Record three examples of your own conducting cue; their normalized hand trajectories stay in local browser storage and can re-articulate the drone.

### Gesture regression harness

Serve the project normally, then open [http://localhost:4173/gesture-tests.html](http://localhost:4173/gesture-tests.html). The harness runs the recordings in `gesture-fixtures/` through the same MediaPipe input and gesture state machine used by the live camera.

Each fixture filename describes its required semantic event sequence. A test passes only when the observed `start`, `raise`, `lower`, and `stop` events match that sequence exactly—missing, extra, and out-of-order commands all fail. Runs use video timestamps, begin only after the hand model is warm, isolate application state between fixtures, and report both FSM transitions and hand-detection coverage to distinguish tracking failures from recognition failures.

Use **Run all fixtures** for the complete real-time suite or run one fixture while tuning a recognizer. The suite intentionally runs at natural speed because the interaction depends on conducting timing.

## Evaluation Criteria

### Technological Implementation

How thoroughly and skillfully does the project use Codex? Does the code reflect genuine effort and a working, non-trivial implementation?

### Design

Does the project deliver a working or runnable project that has a complete, coherent product experience — not just a technical proof of concept?

### Potential Impact

Does the project make a credible, specific case for solving a real problem for a real audience — and does the solution actually address that problem based on what's demonstrated?

### Quality of the Idea

Is the project creative? Does the team demonstrate genuine understanding of the problem space they're working in?

## Submission Guidelines

**A working project.** Build something with Codex using GPT-5.6 that meets the challenge requirements.

**A category.** Pick the category that fits best.

**A project description.** Tell us what you created and how it works.

**A demo video.** Upload a <3-minute public YouTube video showing your project working, with audio covering how you used Codex and GPT-5.6.

**Provide a URL to your code repository** for judging and testing. The repository must be either public (with relevant licensing) or private and shared with testing@devpost.com and build-week-event@openai.com.

Include a **README** with setup instructions, sample data (if needed), and clear guidance for running your project.

Make sure to **highlight where Codex accelerated your workflow**, where key decisions were made, and **how GPT-5.6 and Codex were used**. This is an important part of how judges evaluate technological implementation and quality of the idea.

**/feedback Codex Session ID.** For the session where you built most of your project's core functionality, get the `/feedback` session ID and enter it in your submission form.
