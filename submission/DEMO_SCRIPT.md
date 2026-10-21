# KinLoop demo script (target 2:45, hard limit 2:50)

**Setup before recording**
- Open `<BASE>/simulator/` full screen in Chrome, with **Speak replies** on. Click **Reset demo**.
- The stack is deployed with `DEMO_LOCAL_TIME=08:20`, so it's 8:20 AM in Kamala's day.
- Have Arjun's real phone (or the email inbox) visible in a corner to catch the SNS alert.
- Have a second tab on `<BASE>/dashboard/`, signed in as `arjun` / `2222`.
- Have a third tab with `submission/architecture.png`.
- Record at 1080p, with no music. Narration in English.

Lead with the strongest moment: the red flag landing on Arjun's phone falls inside the first 75 seconds.

---

### 0:00–0:20 · The problem, through one story
**Screen:** title card "KinLoop: your parents' daily check-in, through Alexa", then the simulator.

**Say:** "Kamala is 72 and lives alone in Jaipur. Her son Arjun works in Bengaluru. She won't use apps, she forgets her evening pills, and when she feels unwell she doesn't say so, because she doesn't want anyone to worry. Arjun finds out when it's already serious. But Kamala will talk to Alexa."

### 0:20–1:30 · Kamala talks to Alexa (left pane)
1. **Click the mic and say:** "Alexa, what do I need to do today?"
   Alexa replies with her 8 AM medicines, the 4:30 eye check-up, and Arjun's message.
   **Say:** "One MCP server. Alexa+ picks the tool, and the trace below shows `get_today_plan`, about 10 milliseconds."
2. **Say:** "I just took my blood pressure pill."
   Alexa: "Got it. Your Amlodipine 5 mg for 8 AM is marked as taken."
   **Say:** "It matched 'blood pressure pill' to Amlodipine. Say it twice and it won't double-count."
3. **Say:** "I'm feeling dizzy and I nearly fainted."
   Alexa: "Kamala, fainting can be serious. Please call 112 now… I've alerted Arjun."
   **Right pane:** the red alert slides in on Arjun's phone. Cut to the real email or SMS arriving.
   **Say:** "That decision wasn't made by an AI. It's a fixed rule: fainting is a red flag, so the family is alerted instantly, with the reason and the time. Alexa tells her to call emergency services, because KinLoop never pretends to be one."

### 1:30–2:10 · Arjun asks his own Alexa (right pane, then the dashboard)
4. **Say:** "Alexa, how's Mom doing today?"
   Alexa: "Urgent: Kamala reported fainting… Kamala has taken 1 of 2 doses due so far today. Kamala hasn't checked in yet today."
5. **Switch to the dashboard tab:** the urgent banner, timeline, medicine chips, 7-day adherence and mood charts.
   **Say:** "Every afternoon Arjun also gets a warm two-line summary, written by Amazon Bedrock from the logged facts only, precomputed so Alexa answers in under half a second."
6. **Back to the simulator trace:** point at the latency column (every call well under 500 ms) and the Bedrock digest card (model ID, latency, tokens).

### 2:10–2:45 · How it's built
**Screen:** the architecture diagram.

**Say:** "KinLoop is a self-hosted MCP server on the 2025-11-25 spec, using Streamable HTTP and fully stateless, with OAuth 2.1 and PKCE account linking. It runs on AWS Lambda. DynamoDB stores the day with time-to-live, EventBridge Scheduler runs the rules every ten minutes, SNS delivers the alerts, and Amazon Bedrock writes the summaries off the voice path. The rules decide, and the LLM only writes. There's a hundred percent test coverage on the safety rules."

### 2:45 · End card
"KinLoop · github.com/Yashika2211/amazon · Not a medical device; does not replace emergency services."

---

**Fallback (CUT LINE A):** if the real Alexa+ add-on isn't available, this whole script runs on the simulated Alexa+ client. It's a real MCP client that uses Amazon Bedrock tool use to drive the same MCP server, which the track rules allow. Say so in one line at 0:20: "This is our simulated Alexa+ client, calling the real MCP server."
