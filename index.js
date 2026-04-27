require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const Groq = require("groq-sdk");

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const RE_BASE = "https://www.robotevents.com/api/v2";
const RE_HEADERS = {
    "Authorization": `Bearer ${process.env.ROBOT_EVENTS_TOKEN}`,
    "Content-Type": "application/json"
};

// Season map
const SEASONS = {
    "1": { id: 204, name: "Override 2026-27" },
    "2": { id: 197, name: "Push Back 2025-26" },
    "3": { id: 190, name: "High Stakes 2024-25" },
    "4": { id: 181, name: "Over Under 2023-24" },
};

const SEASON_PROMPT = `Pick a season:
1️⃣ Override 2026-27
2️⃣ Push Back 2025-26
3️⃣ High Stakes 2024-25
4️⃣ Over Under 2023-24
Reply with the number (e.g. \`1\`)`;

// Helper to ask Groq
async function askGroq(prompt) {
    const response = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500
    });
    return response.choices[0].message.content;
}

// Helper to get team
async function getTeam(teamNumber, seasonId) {
    const res = await fetch(`${RE_BASE}/teams?number=${teamNumber}&program[]=1&season[]=${seasonId}`, { headers: RE_HEADERS });
    const data = await res.json();
    return data.data?.[0] || null;
}

// Helper to get matches
async function getMatches(teamId, seasonId) {
    const res = await fetch(`${RE_BASE}/teams/${teamId}/matches?season[]=${seasonId}&per_page=5`, { headers: RE_HEADERS });
    const data = await res.json();
    return data.data || [];
}

// Helper to get rankings
async function getRankings(teamId, seasonId) {
    const res = await fetch(`${RE_BASE}/teams/${teamId}/rankings?season[]=${seasonId}&per_page=5`, { headers: RE_HEADERS });
    const data = await res.json();
    return data.data || [];
}

// Helper to get skills
async function getSkills(teamId, seasonId) {
    const res = await fetch(`${RE_BASE}/teams/${teamId}/skills?season[]=${seasonId}&per_page=5`, { headers: RE_HEADERS });
    const data = await res.json();
    return data.data || [];
}

// Helper to calculate win rate
function calcWinRate(rankings) {
    if (!rankings || rankings.length === 0) return "N/A";
    const totals = rankings.reduce((acc, r) => ({
        wins: acc.wins + r.wins,
        losses: acc.losses + r.losses,
        ties: acc.ties + r.ties
    }), { wins: 0, losses: 0, ties: 0 });
    const total = totals.wins + totals.losses + totals.ties;
    const rate = total > 0 ? ((totals.wins / total) * 100).toFixed(1) : 0;
    return `${rate}% (${totals.wins}W ${totals.losses}L ${totals.ties}T)`;
}

// Store pending commands waiting for season input
const pending = new Map();

client.once("ready", () => console.log(`Bot online as ${client.user.tag} and ready to scout!`));

client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    // Handle season selection for pending commands
    if (pending.has(msg.author.id)) {
        const { command, teamNumber, team2Number } = pending.get(msg.author.id);
        const seasonChoice = msg.content.trim();
        const season = SEASONS[seasonChoice];

        if (!season) {
            return msg.reply("Invalid choice! Reply with `1`, `2`, `3`, or `4`.");
        }

        pending.delete(msg.author.id);
        await msg.reply(`Got it! Using **${season.name}**...`);

        if (command === "scout") {
            const team = await getTeam(teamNumber, season.id);
            if (!team) return msg.reply(`Team **${teamNumber}** not found in **${season.name}**!`);

            const [rankings, skills] = await Promise.all([
                getRankings(team.id, season.id),
                getSkills(team.id, season.id)
            ]);

            const winRate = calcWinRate(rankings);
            const driverSkills = skills?.find(s => s.type === "driver")?.score || "N/A";
            const autoSkills = skills?.find(s => s.type === "programming")?.score || "N/A";

            const prompt = `You are a VEX Robotics scouting assistant. Here is the data for team ${teamNumber} in the ${season.name} season:
            - Team Name: ${team.team_name}
            - Organization: ${team.organization}
            - Location: ${team.location.city}, ${team.location.region}, ${team.location.country}
            - Program: ${team.program.name}
            - Grade: ${team.grade}
            - Robot Name: ${team.robot_name || "Unknown"}
            - Win Rate: ${winRate}
            - Driver Skills Score: ${driverSkills}
            - Autonomous Skills Score: ${autoSkills}
            
            Give a detailed scouting report. Be concise and useful for a VEX competition.
            IMPORTANT: Only include information you actually know. Do NOT use placeholder text like [Insert...] or [Unknown]. If you don't know something, skip it entirely.`;

            const report = await askGroq(prompt);
            msg.reply(`**Scouting Report for ${team.team_name} (${team.number}) — ${season.name}:**\n${report}`);
        }

        if (command === "matches") {
            const team = await getTeam(teamNumber, season.id);
            if (!team) return msg.reply(`Team **${teamNumber}** not found in **${season.name}**!`);

            const matches = await getMatches(team.id, season.id);
            if (!matches || matches.length === 0) return msg.reply(`No matches found for **${teamNumber}** in **${season.name}**!`);

            const matchSummary = matches.map(m => {
                const red = m.alliances[0];
                const blue = m.alliances[1];
                return `Round: ${m.round} | ${red.teams.map(t => t.team.name).join(" & ")} vs ${blue.teams.map(t => t.team.name).join(" & ")} | Score: ${red.score} - ${blue.score}`;
            }).join("\n");

            const avgScore = matches.map(m => {
                const alliance = m.alliances.find(a => a.teams.some(t => t.team.name === teamNumber));
                return alliance?.score || 0;
            });
            const avg = (avgScore.reduce((a, b) => a + b, 0) / avgScore.length).toFixed(1);

            const prompt = `You are a VEX Robotics scouting assistant. Analyze these recent matches for team ${teamNumber} in ${season.name}:
            ${matchSummary}
            Average score per match: ${avg}
            
            Analyze their recent match performance including scoring consistency and competition level.
            Be concise and useful for a VEX competition.
            IMPORTANT: Only include information you actually know. Do NOT use placeholder text.`;

            const analysis = await askGroq(prompt);
            msg.reply(`**Recent Matches for ${teamNumber} — ${season.name}:**\n\`\`\`${matchSummary}\`\`\`\n**Average Score:** ${avg}\n**AI Analysis:**\n${analysis}`);
        }

        if (command === "rankings") {
            const team = await getTeam(teamNumber, season.id);
            if (!team) return msg.reply(`Team **${teamNumber}** not found in **${season.name}**!`);

            const [rankings, skills] = await Promise.all([
                getRankings(team.id, season.id),
                getSkills(team.id, season.id)
            ]);

            if (!rankings || rankings.length === 0) return msg.reply(`No rankings found for **${teamNumber}** in **${season.name}**!`);

            const rankSummary = rankings.map(r =>
                `Event: ${r.event.name} | Rank: ${r.rank} | Wins: ${r.wins} | Losses: ${r.losses} | Ties: ${r.ties} | WP: ${r.wp}`
            ).join("\n");

            const winRate = calcWinRate(rankings);
            const driverSkills = skills?.find(s => s.type === "driver")?.score || "N/A";
            const autoSkills = skills?.find(s => s.type === "programming")?.score || "N/A";

            const prompt = `You are a VEX Robotics scouting assistant. Analyze these rankings for team ${teamNumber} in ${season.name}:
            ${rankSummary}
            - Overall Win Rate: ${winRate}
            - Driver Skills Score: ${driverSkills}
            - Autonomous Skills Score: ${autoSkills}
            
            Analyze their ranking performance and skills scores. Be concise and useful for a VEX competition.
            IMPORTANT: Only include information you actually know. Do NOT use placeholder text.`;

            const analysis = await askGroq(prompt);
            msg.reply(`**Rankings for ${teamNumber} — ${season.name}:**\n\`\`\`${rankSummary}\`\`\`\n**Win Rate:** ${winRate} | **Driver Skills:** ${driverSkills} | **Auto Skills:** ${autoSkills}\n**AI Analysis:**\n${analysis}`);
        }

        if (command === "compare") {
            const [team1, team2] = await Promise.all([
                getTeam(teamNumber, season.id),
                getTeam(team2Number, season.id)
            ]);

            if (!team1) return msg.reply(`Team **${teamNumber}** not found in **${season.name}**!`);
            if (!team2) return msg.reply(`Team **${team2Number}** not found in **${season.name}**!`);

            const [rank1, rank2, skills1, skills2] = await Promise.all([
                getRankings(team1.id, season.id),
                getRankings(team2.id, season.id),
                getSkills(team1.id, season.id),
                getSkills(team2.id, season.id)
            ]);

            const winRate1 = calcWinRate(rank1);
            const winRate2 = calcWinRate(rank2);
            const driver1 = skills1?.find(s => s.type === "driver")?.score || "N/A";
            const driver2 = skills2?.find(s => s.type === "driver")?.score || "N/A";
            const auto1 = skills1?.find(s => s.type === "programming")?.score || "N/A";
            const auto2 = skills2?.find(s => s.type === "programming")?.score || "N/A";

            const prompt = `You are a VEX Robotics scouting assistant. Compare these two teams in ${season.name}:

            Team 1: ${team1.team_name} (${teamNumber})
            - Location: ${team1.location.city}, ${team1.location.region}
            - Grade: ${team1.grade}
            - Robot: ${team1.robot_name || "Unknown"}
            - Win Rate: ${winRate1}
            - Driver Skills: ${driver1}
            - Autonomous Skills: ${auto1}

            Team 2: ${team2.team_name} (${team2Number})
            - Location: ${team2.location.city}, ${team2.location.region}
            - Grade: ${team2.grade}
            - Robot: ${team2.robot_name || "Unknown"}
            - Win Rate: ${winRate2}
            - Driver Skills: ${driver2}
            - Autonomous Skills: ${auto2}

            Give a detailed head to head comparison and a clear recommendation on which team is stronger and why.
            Be concise and useful for a VEX competition.
            IMPORTANT: Only include information you actually know. Do NOT use placeholder text.`;

            const comparison = await askGroq(prompt);
            msg.reply(`**Comparison: ${teamNumber} vs ${team2Number} — ${season.name}**\n\`\`\`${teamNumber}: WR ${winRate1} | Driver ${driver1} | Auto ${auto1}\n${team2Number}: WR ${winRate2} | Driver ${driver2} | Auto ${auto2}\`\`\`\n**AI Analysis:**\n${comparison}`);
        }

        return;
    }

    const args = msg.content.slice(1).trim().split(" ");
    const command = args.shift().toLowerCase();

    if (command === "scout") {
        const teamNumber = args[0];
        if (!teamNumber) return msg.reply("Usage: `!scout 123A`");
        pending.set(msg.author.id, { command: "scout", teamNumber });
        await msg.reply(SEASON_PROMPT);
    }

    if (command === "matches") {
        const teamNumber = args[0];
        if (!teamNumber) return msg.reply("Usage: `!matches 123A`");
        pending.set(msg.author.id, { command: "matches", teamNumber });
        await msg.reply(SEASON_PROMPT);
    }

    if (command === "rankings") {
        const teamNumber = args[0];
        if (!teamNumber) return msg.reply("Usage: `!rankings 123A`");
        pending.set(msg.author.id, { command: "rankings", teamNumber });
        await msg.reply(SEASON_PROMPT);
    }

    if (command === "compare") {
        const team1Number = args[0];
        const team2Number = args[1];
        if (!team1Number || !team2Number) return msg.reply("Usage: `!compare 123A 456B`");
        pending.set(msg.author.id, { command: "compare", teamNumber: team1Number, team2Number });
        await msg.reply(SEASON_PROMPT);
    }
});

client.login(process.env.TOKEN);
