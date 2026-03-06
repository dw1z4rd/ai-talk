# Escape Room Game Design

**Goal**: Replace the current "Whose Line" game link on the main page with a new interactive "Escape Room" game. This game relies on an LLM acting as a Dungeon Master to dynamically create scenarios and manage a text-based escape room puzzle. The game includes a HUD for real-time state tracking (Location, Inventory, Clues).

## Architecture & Data Flow

- **Frontend (SvelteKit)**: A new route `/escape-room`. The layout consists of:
  - **Narrative Chat Area**: A scrollable history of the DM's descriptions and the player's inputs.
  - **HUD Sidebar**: Displays current `Location`, `Inventory`, and `Discovered Clues`.
- **Backend (API)**: 
  - `/api/escape-room/init`: Initializes a fresh, uniquely generated scenario.
  - `/api/escape-room/chat`: Handles user actions, passing the current conversation and game state to the LLM.
- **LLM Integration**: Uses the existing `llm-agent` logic. The system prompt instructs the LLM to behave as a DM.
- **State Management**: The LLM controls state by appending special tags to its responses:
  - `[LOCATION_SET: 🏰 The Cellar]`
  - `[INVENTORY_ADD: 🗝️ rusted_key]`
  - `[INVENTORY_REMOVE: 🗝️ rusted_key]`
  - `[CLUE_FOUND: 📜 torn_journal]`
  - `[WIN_CONDITION_MET]`
  - `[LOSE_CONDITION_MET]`
  The backend/frontend parses these tags, updates the visual HUD, and removes the tags from the user-facing narrative text.

## UI Components & Game Loop

- **HUD Display**: Inventory items and clues will be represented by an emoji and a name (e.g., "🗝️ rusted_key") provided dynamically by the LLM. 
- **Game Initialization**: The first call generates a unique setting (e.g., haunted submarine, sci-fi cloning lab) with one win condition and 3-5 interactive items.
- **Game End**: Triggered by the `[WIN_CONDITION_MET]` or `[LOSE_CONDITION_MET]` tags, which locks input and shows an end screen.

## Dynamic Assets

To provide a polished feel without requiring an expensive image generation API, the LLM will select appropriate emojis to serve as "icons" for items and locations. This ensures a consistent, visually pleasing HUD with zero latency.

## Next Steps

Invoke the `writing-plans` skill to break this design down into concrete implementation steps.