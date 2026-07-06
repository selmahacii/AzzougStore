import re

with open('src/components/admin/agent-orders-page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract Dialog
dialog_match = re.search(r'(<Dialog open=\{isCreatingOrder\}.*?</Dialog>)', content, re.DOTALL)
if dialog_match:
    dialog_code = dialog_match.group(1)
    with open('scratch/manual_dialog.tsx', 'w', encoding='utf-8') as out:
        out.write(dialog_code)
    print("Extracted dialog!")
else:
    print("Could not find dialog")
