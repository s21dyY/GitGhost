import type { HumanOrigin } from './types';

/** EDIT HERE: original human designs, habits, and imagined memories.
 * All memories are fictional. All asset keys below still need artwork.
 * Keep IDs stable after shipping; changing prose is safe, renaming IDs needs migration.
 */
export const HUMANS: readonly HumanOrigin[] = [
  {
    id: 'archivist', internalName: 'The Archivist',
    purposeKeywords: ['documentation', 'reference', 'knowledge', 'wiki', 'docs'],
    signatureObject: 'A book clasped with a tiny brass hand',
    palette: ['#B8AC91', '#394B50', '#141C25', '#718E84'],
    humanVoice: 'Measured, thoughtful, attentive to details; speak of pages and margins sparingly.',
    habits: ['Straightens a page that is already straight', 'Saves a place with one finger'],
    fictionalMemory: 'An imagined room of shelves. One lamp remains lit for a reader who has not arrived.',
    stages: {
      human: { silhouette: 'Long coat, narrow shoulders, book held near heart', face: 'Tired but attentive eyes', movement: 'Checks the index; slow breathing', asset: { key: 'archivist-human', status: 'needs-art', description: 'Human archivist with brass-clasp book, pixel art.' } },
      distorted: { silhouette: 'Same coat and book; pages climb toward the jaw', face: 'Ink appears below one eye', movement: 'Turns one page twice', asset: { key: 'archivist-distorted', status: 'needs-art', description: 'Preserve human anchors; a page partially covers the cheek.' } },
      transformed: { silhouette: 'Book opens where the face once was; coat remains recognizable', face: 'Two eyes watch from separate pages', movement: 'Pages turn against an invisible wind', asset: { key: 'archivist-transformed', status: 'needs-art', description: 'Book-faced entity with paper fingers, same brass clasp.' } },
    },
    greetings: ['A reader. Let me find your place.', 'The margins remember more than the cover.'],
    creativeNotes: 'Add imagined objects, gestures, or visual details here. Never attribute this memory to a real maintainer.',
  },
  {
    id: 'radio-operator', internalName: 'The Radio Operator',
    purposeKeywords: ['audio', 'sound', 'music', 'radio', 'streaming', 'speech'],
    signatureObject: 'Headphones repaired with a single copper wire',
    palette: ['#A4B5AC', '#456168', '#121B26', '#BE8C5C'],
    humanVoice: 'Brief, attentive phrases; listen carefully, confirm what was heard.',
    habits: ['Adjusts one ear cup', 'Taps a reply before speaking'],
    fictionalMemory: 'An imagined night shift. The operator waits for a station that has never broadcast.',
    stages: {
      human: { silhouette: 'Short jacket, headphones, small receiver', face: 'Concentrated expression', movement: 'Leans toward the receiver', asset: { key: 'radio-operator-human', status: 'needs-art', description: 'Human operator with copper-repaired headphones.' } },
      distorted: { silhouette: 'Receiver seems to sink into jacket', face: 'One eye becomes a dim indicator', movement: 'Responds to a silent pulse', asset: { key: 'radio-operator-distorted', status: 'needs-art', description: 'Same figure; chest dial begins to glow.' } },
      transformed: { silhouette: 'A hollow receiver occupies the chest; headset remains', face: 'Dark face with two distant signal lights', movement: 'Chest pulse, slight delayed head turn', asset: { key: 'radio-operator-transformed', status: 'needs-art', description: 'Spectral receiver entity, no actual audio required.' } },
    },
    greetings: ['Receiving. Somewhere, something is receiving.', 'Your signal reached the room.'],
    creativeNotes: 'Signal metaphors are fictional; never imply microphone or camera access.',
  },
  {
    id: 'clockmaker', internalName: 'The Clockmaker',
    purposeKeywords: ['automation', 'workflow', 'scheduler', 'scheduling', 'cron', 'pipeline'],
    signatureObject: 'A pocket watch with a square winding key',
    palette: ['#BCA078', '#586C68', '#171B23', '#8E6558'],
    humanVoice: 'Patient and practical; explain sequences and small adjustments.',
    habits: ['Counts three beats on a sleeve', 'Checks a watch without opening it'],
    fictionalMemory: 'An imagined workshop in which every clock waits for someone else to begin.',
    stages: {
      human: { silhouette: 'Rolled sleeves, tool apron, pocket watch', face: 'Careful squint', movement: 'Turns a small key', asset: { key: 'clockmaker-human', status: 'needs-art', description: 'Human craftsperson with square watch key.' } },
      distorted: { silhouette: 'A second shadow-hand appears behind the wrist', face: 'Eyes look in slightly different directions', movement: 'Repeats a winding motion', asset: { key: 'clockmaker-distorted', status: 'needs-art', description: 'Same watch and apron; one impossible extra hand.' } },
      transformed: { silhouette: 'Several thin arms frame the original torso', face: 'Clock-like hollow with two unmoving eyes', movement: 'Hands repeat different small tasks', asset: { key: 'clockmaker-transformed', status: 'needs-art', description: 'Clockwork entity whose original watch remains prominent.' } },
    },
    greetings: ['One more turn. There is always one more turn.', 'We can begin with the smallest mechanism.'],
    creativeNotes: 'Repeating motions should be slow; no fast jitter or flashing.',
  },
  {
    id: 'watchkeeper', internalName: 'The Watchkeeper',
    purposeKeywords: ['security', 'authentication', 'authorization', 'monitoring', 'access', 'firewall'],
    signatureObject: 'A lantern with a cracked blue pane',
    palette: ['#899E9E', '#33474B', '#111822', '#9AB9AE'],
    humanVoice: 'Calm, watchful, direct; says plainly what it can still remember of itself.',
    habits: ['Raises the lantern before answering', 'Counts the keys by touch'],
    fictionalMemory: 'An imagined doorway. The watchkeeper cannot remember which side they were guarding.',
    stages: {
      human: { silhouette: 'Heavy cloak, lantern, keyring', face: 'Watchful neutral expression', movement: 'Small lantern sway', asset: { key: 'watchkeeper-human', status: 'needs-art', description: 'Human sentinel with cracked blue lantern.' } },
      distorted: { silhouette: 'Shadow leans opposite the lantern', face: 'One eye seems reflected in the glass', movement: 'Shadow follows one beat late', asset: { key: 'watchkeeper-distorted', status: 'needs-art', description: 'Preserve cloak and lantern; shadow misalignment.' } },
      transformed: { silhouette: 'Empty cloak held upright by a watchful lantern', face: 'A large eye inside the lantern', movement: 'Lantern turns before the body', asset: { key: 'watchkeeper-transformed', status: 'needs-art', description: 'Lantern-eyed entity with original blue pane and keyring.' } },
    },
    greetings: ['The door is open. That is not the same as an invitation.', 'Come within the light. Let me remember what I was.'],
    creativeNotes: 'Never imply verified security, surveillance, or actual protection based on character design.',
  },
  {
    id: 'bellwraith', internalName: 'The Bellwraith',
    purposeKeywords: ['notification', 'notifications', 'notify', 'alert', 'alerts', 'alerting', 'reminder', 'reminders', 'announcement', 'announcements', 'broadcast', 'bell'],
    signatureObject: 'A brass hand-bell with a worn wooden grip',
    palette: ['#C59636', '#6B4C2B', '#14120D', '#ADB08A'],
    humanVoice: 'Warm and welcoming, whatever its temperament: glad of company, calls the visitor "friend", rings a little bell to greet them.',
    habits: ['Rings the bell once before answering', 'Warms the bell between both hands'],
    fictionalMemory: 'An imagined bell tower at dusk. The ringer calls everyone home, and is always the last one left outside.',
    stages: {
      human: { silhouette: 'Tall pointed hood, long robe, hand-bell held low', face: 'Pale, kind, tired eyes', movement: 'The bell sways a little with each breath', asset: { key: 'bellwraith-human', status: 'needs-art', description: 'Hooded bell-ringer with a brass hand-bell.' } },
      distorted: { silhouette: 'Same hood and bell; the robe is opened over the ribs', face: 'Half the face torn into a dark wound full of small teeth', movement: 'The bell rings on its own, the mouth repeats the last word', asset: { key: 'bellwraith-distorted', status: 'needs-art', description: 'Preserve hood and bell; one-sided rupture.' } },
      transformed: { silhouette: 'Hood crowned with a spiked corona; a starry hollow in the chest', face: 'A dark hollow ringed with many eyes', movement: 'The bell tolls; everything it says comes back as an echo', asset: { key: 'bellwraith-transformed', status: 'needs-art', description: 'Many-eyed bell-bearer whose bell remains prominent.' } },
    },
    greetings: ['Oh, come in, friend! I rang the bell for you.', 'There you are. Come in out of the cold, friend.'],
    creativeNotes: 'Warm only while human. Changed, it has no words of its own and can only repeat what it heard: echoes of its purpose, its code, its records. Echoes are exact quotes, never paraphrase.',
  },
];
