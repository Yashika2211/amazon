# Video narration: KinLoop (target 2:45, hard limit under 3:00)

About 390 words at a calm pace. Read the **bold** lines aloud; the *italic* lines are what to click.

## Before you hit record
- Open the live demo full screen in Chrome and click **Reset demo**. Turn **Speak replies** on, so Alexa's voice is in the video.
- Have the dashboard tab signed in as `arjun` / `2222`, and the email inbox ready to show the alert.
- Have `submission/architecture.png` open in a third tab.
- No background music. Speak in English. Record at 1080p (QuickTime → New Screen Recording, or OBS).
- Clicking the quick phrases is fine; you don't have to speak into the mic. The typed phrase goes through exactly the same path.

---

### 0:00–0:20 · The story
*Screen: the simulator, both panes visible.*

**"Kamala is seventy-two and lives alone in Jaipur. Her son Arjun works in Bengaluru. She forgets her evening pills, and when she feels unwell she doesn't tell anyone, because she doesn't want them to worry. But Kamala will talk to Alexa. This is KinLoop."**

### 0:20–0:50 · Kamala's morning
*Click: "Alexa, what do I need to do today?" The Echo Show card appears.*

**"KinLoop is an Alexa+ add-on built as an MCP server. Kamala asks for her day, and Alexa reads her medicines, her eye check-up and her son's message. The Echo Show card is an MCP Apps resource, rendered from the server."**

*Click: "I just took my blood pressure pill".*

**"She says 'blood pressure pill', and KinLoop matches it to her Amlodipine. Say it twice and it won't double-count."**

### 0:50–1:25 · The red flag (the key moment)
*Click: "I'm feeling dizzy and I nearly fainted". The red alert slides onto Arjun's phone.*

**"Now she says she nearly fainted. Alexa tells her to call 112, and at that same moment Arjun's phone gets an urgent alert, by email through Amazon SNS."** *(Briefly show the email.)*

**"No AI made that decision. It's a fixed safety rule, tested to a hundred percent. And it works in Hindi too."**

*Toggle हिन्दी, then click "मुझे सीने में दर्द हो रहा है".*

**"Chest pain in Hindi triggers the same rule."**

### 1:25–2:05 · Arjun's side
*Right pane, click: "How's Mom doing today?"*

**"From Bengaluru, Arjun asks his own Alexa how Mom is doing. He hears the urgent alert first, then her doses, and that her Metformin runs out in four days."**

*Click: "I'm calling her now". Then in the kitchen, click "What do I need to do today?"*

**"He says he's calling her. The alert is marked handled, and Kamala's Alexa now tells her Arjun has seen it. The loop closes on both sides."**

*Switch to the dashboard tab and scroll once.*

**"The family dashboard shows the timeline, a week of adherence and mood, and the daily summary."**

### 2:05–2:40 · How it's built
*Show the architecture diagram, then the MCP trace panel.*

**"One stateless MCP server on the 2025-11-25 spec, over Streamable HTTP, with OAuth 2.1 and PKCE for account linking. It runs on AWS Lambda with DynamoDB, EventBridge Scheduler and SNS. Every tool answers in under seventy milliseconds on the server, well inside Alexa's five-hundred-millisecond budget. Bedrock writes the family summary in the background, and a deterministic check rejects any sentence that isn't backed by the facts. In production, it caught the model inventing a missed dose."**

### 2:40–2:50 · Close
*End card: KinLoop · github.com/Yashika2211/amazon*

**"Rules decide. The AI only writes. KinLoop: your parents' daily check-in, through Alexa."**

---

**If anything goes wrong mid-recording:** click **Reset demo**, wait two seconds, and restart from the current section. Edit the cuts together afterwards.
