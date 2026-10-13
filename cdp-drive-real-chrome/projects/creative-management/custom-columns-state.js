(() => { const dlg = [...document.querySelectorAll('.el-dialog')].find(e => e.getBoundingClientRect().width > 0 && /Custom Columns/.test(e.innerText));
 if (!dlg) return null;
 const lines = dlg.innerText.split('\n').map(s => s.trim()).filter(Boolean);
 return { selectedLine: lines.find(l => l.startsWith('Selected')), visibleBoxes: [...dlg.querySelectorAll('.el-checkbox')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.innerText.trim() + (e.className.includes('is-checked') ? ' [x]' : ' [ ]')),
   buttons: [...dlg.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => b.innerText.trim()) }; })()
