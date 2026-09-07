const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
// This is a source-format assertion, not an HTML sanitizer.
const start=html.indexOf('<script>'),end=html.indexOf('</script>',start);
assert.ok(start>=0&&end>start,'Expected the single inline script');
assert.equal(html.indexOf('<script>',start+8),-1,'The app must remain one inline script');
new vm.Script(html.slice(start+8,end),{filename:'index.html'});
new vm.Script(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{filename:'sw.js'});
assert.ok(html.includes('name="health-app-version" content="2.8.3"'));
assert.ok(!/<script[^>]+src=/.test(html),'No external runtime scripts');
assert.ok(!/from\s+['"](?:react|@supabase)/.test(html));
assert.ok(!/(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}/.test(html),'No credential literals');
console.log('PASS: inline JavaScript syntax, worker syntax, static architecture, version and credential-literal checks');
