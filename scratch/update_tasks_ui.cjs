const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src/pages/email-intelligence/TasksCalendar.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Remove Sidebar
const sidebarStart = content.indexOf('{/* Sidebar */}');
const sidebarEnd = content.indexOf('{/* Main Calendar Area */}');
if (sidebarStart !== -1 && sidebarEnd !== -1) {
  content = content.slice(0, sidebarStart) + content.slice(sidebarEnd);
}

// 2. Remove "Viewing Downtown by Week as Users" text
const viewingTextStart = content.indexOf('<div className="flex items-center gap-3 text-[13px] text-gray-500">');
const viewingTextEnd = content.indexOf('</div>', content.indexOf('<div className="flex items-center gap-1.5">as '));
if (viewingTextStart !== -1 && viewingTextEnd !== -1) {
  content = content.slice(0, viewingTextStart) + '<div>' + content.slice(viewingTextEnd + 6); // Add an empty div or just remove the whole parent div. Actually I can just remove the whole thing.
}
// wait let's just find and replace the whole Viewing div string.
content = content.replace(
  /<div className="flex items-center gap-3 text-\[13px\] text-gray-500">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
  '</div>\n            </div>'
);


// 3. Fix sender parsing
const senderLogicStart = content.indexOf('// Group tasks by sender');
const senderLogicEnd = content.indexOf('// Sort tasks by due date');

if (senderLogicStart !== -1 && senderLogicEnd !== -1) {
  const newSenderLogic = `// Helper to parse sender
                  const parseSender = (senderStr) => {
                    if (!senderStr) return 'Self/System';
                    try {
                      const parsed = JSON.parse(senderStr);
                      if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed[0].name || parsed[0].email || 'Unknown Sender';
                      }
                    } catch (e) {
                      // ignore
                    }
                    const match = senderStr.match(/^([^<]+)/);
                    return match ? match[1].trim() : senderStr;
                  };
                  
                  // Group tasks by sender
                  const senders = Array.from(new Set(tasks.map(t => parseSender(t.raw_emails?.sender))));
                  
                  `;
  content = content.slice(0, senderLogicStart) + newSenderLogic + content.slice(senderLogicEnd);
}

// Also need to update the sender Tasks mapping where it filters by raw_emails?.sender
const filterLogicOld = `const senderTasks = sortedTasks.filter(t => (t.raw_emails?.sender || 'Self/System') === sender);`;
const filterLogicNew = `const senderTasks = sortedTasks.filter(t => parseSender(t.raw_emails?.sender) === sender);`;
content = content.replace(filterLogicOld, filterLogicNew);

// Remove the old simple regex
const oldRegex = `// Simple regex to extract name from email sender (e.g. "John Doe <john@doe.com>" -> "John Doe")
                    const senderNameMatch = sender.match(/^([^<]+)/);
                    const senderName = senderNameMatch ? senderNameMatch[1].trim() : sender;`;
const newRegex = `const senderName = sender;`;
content = content.replace(oldRegex, newRegex);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Successfully cleaned UI.");
