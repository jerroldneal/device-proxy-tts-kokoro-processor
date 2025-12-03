# TTS Kokoro Processor

A Python service that monitors a folder for text files and speaks them using the **Kokoro** open-weight TTS model (82M parameters).

## Architecture

This service watches the shared volume `C:/.tts/todo`. When a file appears, it:

1. Moves it to `working`.
2. Reads the text.
3. Generates audio using the local Kokoro model (downloaded on first run).
4. Plays the resulting audio using `mpv`.
5. Moves the file to `done`.

## Configuration

- **Volume**: Mounts host `C:/.tts` to `/app/data`.
- **Cache**: Uses a Docker volume `kokoro_hf_cache` to store the downloaded model weights (~300MB).
- **Voice**: Configurable via `KOKORO_VOICE` in `.env` file. Defaults to `af_heart`.

## Dynamic Voice & Parameter Control

You can change the voice, speed, and volume dynamically within the text file using tags in the format `{key:value}`.

### Supported Tags

-   **`{voice:name}`**: Switches the voice.
    -   Example: `{voice:am_michael}`
    -   Valid values: See "Available Voices" below.
-   **`{speed:float}`**: Changes the playback speed.
    -   Example: `{speed:1.2}` (20% faster), `{speed:0.8}` (20% slower).
    -   Default: `1.0`.
-   **`{volume:int}`**: Changes the playback volume (0-100+).
    -   Example: `{volume:50}` (Half volume), `{volume:150}` (Boosted).
    -   Default: `100`.

### Example Text File

```text
Hello there. {voice:am_michael} I am now speaking with a different voice.
{speed:1.5} And now I am speaking faster! {speed:1.0} Back to normal.
{voice:af_bella} {volume:50} I am whispering now.
```

## Available Voices

You can change the voice by editing the `.env` file or using the `{voice:name}` tag:

### American English

- `af_heart` (Female - Default)
- `af_bella` (Female)
- `af_nicole` (Female)
- `af_sarah` (Female)
- `af_sky` (Female)
- `am_adam` (Male)
- `am_michael` (Male)

### British English

- `bf_emma` (Female)
- `bf_isabella` (Female)
- `bm_george` (Male)
- `bm_lewis` (Male)

## Usage

### Build & Run

```bash
docker-compose up -d --build
```

**Note:** The first run will take some time to download the model weights from Hugging Face.
