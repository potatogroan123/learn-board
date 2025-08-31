require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
 const marked = require('marked');
const app = express();
const PORT = 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.post('/analyze', async (req, res) => {
  const tasks = Array.isArray(req.body.tasks) ? req.body.tasks : [];


  const relevantTasks = tasks
    .filter(t => !t.completed)
    .map((t, i) => {
      const priority = t.priority
        ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1)
        : 'Not Specified';
      const due = t.deadline ? ` (Due: ${t.deadline})` : '';
      return `${i + 1}. [${priority} Priority] ${t.text}${due}`;
    });


  if (relevantTasks.length === 0) {
    return res.json({ assignments: [] });
  }

  const today = new Date().toISOString().split('T')[0];
  const prompt = `
You are an expert task-prioritization assistant. Here are my uncompleted tasks (with user-set priority and optional due date):
${relevantTasks.join('\n')}

Respond ONLY with valid JSON in this exact format (no extra characters before/after, NO markdown, NO backticks):
-Example 1:
- {
-   "assignments": [
-     { "text": "first task text", "priority": "high" },
-     { "text": "second task text", "priority": "medium" }
-   ]
- }
-Example 2:
- {
-   "assignments": [
-     { "text": "Finish report",      "priority": "high"   },
-     { "text": "Grocery shopping",    "priority": "low"    },
-     { "text": "Basketball practice", "priority": "medium" }
-   ]
- }

Instructions:
- + - For *every* task, output exactly one of: "high", "medium", or "low". Do *not* output "" or omit the field.
- If a task has a due date (Due: YYYY-MM-DD), assume today is ${today} and treat earlier dates as more urgent.
- Do NOT wrap the task text in extra symbols or markdown.
- Do NOT add extra comments.
- Do NOT merge or split tasks—one assignment object per input task.
`
.trim();

  try {

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat-v3-0324:free',
        messages: [
          { role: 'system', content: 'You organize to-do tasks by priority and urgency.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errText}`);
    }

    const data = await response.json();
    console.log('OpenRouter raw response:', JSON.stringify(data, null, 2));


    let content = data.choices?.[0]?.message?.content?.trim() || '';


    const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/i;
    const fenceMatch = content.match(fenceRe);
    if (fenceMatch) content = fenceMatch[1].trim();


    function extractJsonObject(str) {
      const start = str.indexOf('{');
      if (start < 0) return null;
      let depth = 0;
      for (let i = start; i < str.length; i++) {
        if (str[i] === '{') depth++;
        else if (str[i] === '}') {
          depth--;
          if (depth === 0) {
            return str.slice(start, i + 1);
          }
        }
      }
      return null;
    }

    const jsonText = extractJsonObject(content);
    if (!jsonText) {
      console.error('No JSON object found in LLM response:', content);
      return res.status(500).json({ error: 'AI returned invalid JSON.' });
    }


    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error('JSON.parse failed on:', jsonText);
      return res.status(500).json({ error: 'AI returned invalid JSON.' });
    }


    if (parsed.assignment && !parsed.assignments) {
      parsed.assignments = parsed.assignment;
      delete parsed.assignment;
    }


    if (!Array.isArray(parsed.assignments)) {
      return res.status(500).json({ error: 'Missing assignments array.' });
    }


    return res.json({ assignments: parsed.assignments });

  } catch (err) {
    console.error('Analyze endpoint error:', err);
    return res.status(500).json({ error: 'OpenRouter request failed.' });
  }
});



app.post("/generate-schedule", async (req, res) => {
  const { tasks } = req.body;

  
  const relevantTasks = tasks
  .filter(t => !t.completed)
  .map((t, i) => {
    const priority = t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1) : "Not Specified";
    const due = t.deadline ? ` (Due: ${t.deadline})` : ""; 
    return `${i + 1}. [${priority} Priority] ${t.text}${due}`;
  });

  if (relevantTasks.length === 0) {
    return res.json({ reply: "No tasks to generate schedule." });
  }

  const prompt = `You are a manager helping the user generate a daily schedule starting from 8 am. These are my current uncompleted tasks, each labeled with a user specified priority:\n\n${relevantTasks.join("\n")}

 Please generate a schedule for me.
  Instructions:
  -Generate the schedule using logic to make the most efficient and prductive schedule for the user to complete all thier tasks`;
  console.log (prompt);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        messages: [
          { role: "system", content: "You are a helpful assistant that organizes to-do tasks based on their stated priority and importance." },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await response.json();
    console.log("OpenRouter raw response:", JSON.stringify(data, null, 2));
    const reply = data?.choices?.[0]?.message?.content || "No response from OpenRouter.";
    
    res.json({ reply });

  } catch (error) {
    console.error("OpenRouter Error:", error);
    res.status(500).json({ error: "OpenRouter request failed." });
  }
});

app.listen(PORT, () => {
  console.log(` Server running at http://localhost:${PORT}`);
});
