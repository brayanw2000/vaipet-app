import fs from 'fs';
const types = fs.readFileSync('src/integrations/supabase/types.ts', 'utf8');
if (types.length < 100) {
    console.error('Types file is empty or too small');
}
