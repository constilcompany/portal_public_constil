const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src/pages/email-intelligence/TasksCalendar.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Remove the MOCK_DATA injected at the top.
const mockStart = content.indexOf('const MOCK_USERS = [');
if (mockStart !== -1) {
  const mockEnd = content.indexOf('];\n\n', content.indexOf('const POSITIONS_COLORS = [')) + 4;
  content = content.slice(0, mockStart) + content.slice(mockEnd);
}

// 2. Replace the grid body with dynamic mapping based on `tasks`.
const gridBodyStart = content.indexOf('{/* Grid Body */}');
const gridBodyEndStr = '</div>\n            </div>\n          </div>\n        </div>\n      )}';
const gridBodyEnd = content.indexOf(gridBodyEndStr);

if (gridBodyStart !== -1 && gridBodyEnd !== -1) {
  const newGridBody = `{/* Grid Body */}
              <div className="min-w-max">
                {/* Dynamically extract senders as "Rows" */}
                {(() => {
                  // Group tasks by sender
                  const senders = Array.from(new Set(tasks.map(t => t.raw_emails?.sender || 'Self/System')));
                  
                  // Sort tasks by due date
                  const sortedTasks = [...tasks].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
                  
                  const colors = ['bg-pink-600', 'bg-[#6b9c65]', 'bg-blue-400', 'bg-purple-600', 'bg-[#a3792c]'];
                  const avatarColors = ['bg-pink-100 text-pink-700', 'bg-green-100 text-green-700', 'bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700'];

                  return senders.map((sender, i) => {
                    const senderTasks = sortedTasks.filter(t => (t.raw_emails?.sender || 'Self/System') === sender);
                    const colorClass = avatarColors[i % avatarColors.length];
                    const shiftColor = colors[i % colors.length];
                    const initial = sender.charAt(0).toUpperCase();
                    
                    // Simple regex to extract name from email sender (e.g. "John Doe <john@doe.com>" -> "John Doe")
                    const senderNameMatch = sender.match(/^([^<]+)/);
                    const senderName = senderNameMatch ? senderNameMatch[1].trim() : sender;

                    return (
                      <div key={sender} className="flex border-b border-gray-200 hover:bg-gray-50/70 transition-colors group bg-white">
                        {/* User Column */}
                        <div className="w-56 shrink-0 border-r border-gray-200 p-2.5 px-3 flex items-center gap-3 bg-white group-hover:bg-gray-50/70 transition-colors sticky left-0 z-10 shadow-[1px_0_2px_rgba(0,0,0,0.02)]">
                          <div className={\`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm \${colorClass}\`}>
                            {initial}
                          </div>
                          <div className="overflow-hidden">
                            <div className="text-[13px] font-semibold text-gray-900 leading-tight truncate">{senderName}</div>
                            <div className="text-[11px] text-gray-500 font-medium truncate">{senderTasks.length} task(s)</div>
                          </div>
                        </div>
                        
                        {/* Days Columns */}
                        {Array.from({length: 7}).map((_, j) => {
                          const day = addDays(currentDate, j);
                          
                          // Find tasks for this sender on this day
                          const dayTasks = senderTasks.filter(t => t.due_date && isSameDay(new Date(t.due_date), day));
                          
                          return (
                            <div key={j} className="flex-1 min-w-[140px] p-1.5 border-r border-gray-200 relative min-h-[60px] group-hover:bg-gray-50/30 transition-colors">
                              {dayTasks.map((t, k) => (
                                <div 
                                  key={t.id}
                                  onClick={() => setSelectedTask(t)}
                                  className={\`rounded-md p-1.5 px-2 mb-1 text-[11px] text-white font-medium cursor-pointer shadow-sm \${t.status === 'completed' ? 'bg-gray-400 opacity-60' : shiftColor} flex flex-col justify-center leading-tight hover:brightness-110 transition-all border-l-4 border-white/20\`}
                                  title={t.title}
                                >
                                  <div className="truncate font-bold">{t.title}</div>
                                  <div className="truncate uppercase opacity-90 text-[9px] mt-0.5 tracking-wider">{t.status}</div>
                                </div>
                              ))}
                              
                              {/* Corner marker if there are tasks */}
                              {dayTasks.length > 0 && (
                                <div className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-r-[8px] border-t-white border-r-transparent opacity-50 mix-blend-overlay pointer-events-none"></div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
`;

  content = content.slice(0, gridBodyStart) + newGridBody + content.slice(gridBodyEnd);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log("Successfully updated TasksCalendar.tsx with dynamic real data.");
} else {
  console.error("Could not find grid body");
}
