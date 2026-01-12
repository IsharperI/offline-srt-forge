// Common misspellings dictionary (expandable)
const CORRECTIONS: Record<string, string> = {
  // Common typos
  'teh': 'the',
  'adn': 'and',
  'taht': 'that',
  'wiht': 'with',
  'thier': 'their',
  'recieve': 'receive',
  'beleive': 'believe',
  'occured': 'occurred',
  'untill': 'until',
  'seperate': 'separate',
  'definately': 'definitely',
  'occassion': 'occasion',
  'accomodate': 'accommodate',
  'acheive': 'achieve',
  'accross': 'across',
  'agressive': 'aggressive',
  'aparent': 'apparent',
  'appearence': 'appearance',
  'arguement': 'argument',
  'assasination': 'assassination',
  'basicly': 'basically',
  'begining': 'beginning',
  'calender': 'calendar',
  'catagory': 'category',
  'cemetary': 'cemetery',
  'changable': 'changeable',
  'collegue': 'colleague',
  'comming': 'coming',
  'commited': 'committed',
  'concious': 'conscious',
  'curiousity': 'curiosity',
  'definitly': 'definitely',
  'desparate': 'desperate',
  'diffrent': 'different',
  'dissapear': 'disappear',
  'dissapoint': 'disappoint',
  'enviroment': 'environment',
  'exagerate': 'exaggerate',
  'existance': 'existence',
  'experiance': 'experience',
  'facinating': 'fascinating',
  'finaly': 'finally',
  'foriegn': 'foreign',
  'fourty': 'forty',
  'freind': 'friend',
  'goverment': 'government',
  'grammer': 'grammar',
  'gratefull': 'grateful',
  'gaurd': 'guard',
  'happend': 'happened',
  'harrass': 'harass',
  'heighth': 'height',
  'heros': 'heroes',
  'humourous': 'humorous',
  'immediatly': 'immediately',
  'independant': 'independent',
  'inteligence': 'intelligence',
  'intresting': 'interesting',
  'interuption': 'interruption',
  'irrelevent': 'irrelevant',
  'its a': "it's a",
  'jewelery': 'jewelry',
  'judgement': 'judgment',
  'knowledgable': 'knowledgeable',
  'liason': 'liaison',
  'libary': 'library',
  'lisence': 'license',
  'maintainance': 'maintenance',
  'manuever': 'maneuver',
  'millenium': 'millennium',
  'minature': 'miniature',
  'mischievious': 'mischievous',
  'mispell': 'misspell',
  'naturaly': 'naturally',
  'neccessary': 'necessary',
  'necessery': 'necessary',
  'noticable': 'noticeable',
  'occurence': 'occurrence',
  'offically': 'officially',
  'oportunity': 'opportunity',
  'optimisim': 'optimism',
  'particulary': 'particularly',
  'passtime': 'pastime',
  'perseverence': 'perseverance',
  'personnell': 'personnel',
  'posession': 'possession',
  'potatos': 'potatoes',
  'preceed': 'precede',
  'presance': 'presence',
  'privelege': 'privilege',
  'probaly': 'probably',
  'profesional': 'professional',
  'promiss': 'promise',
  'pronounciation': 'pronunciation',
  'publically': 'publicly',
  'realy': 'really',
  'reccomend': 'recommend',
  'refered': 'referred',
  'relevent': 'relevant',
  'religous': 'religious',
  'remeber': 'remember',
  'repetition': 'repetition',
  'resistence': 'resistance',
  'restaraunt': 'restaurant',
  'rythm': 'rhythm',
  'saftey': 'safety',
  'sargeant': 'sergeant',
  'scholorship': 'scholarship',
  'sciense': 'science',
  'seige': 'siege',
  'sentance': 'sentence',
  'similiar': 'similar',
  'sinceerly': 'sincerely',
  'speach': 'speech',
  'sucessful': 'successful',
  'supercede': 'supersede',
  'suprise': 'surprise',
  'temperture': 'temperature',
  'tendancy': 'tendency',
  'therefor': 'therefore',
  'threshhold': 'threshold',
  'tomatos': 'tomatoes',
  'tommorow': 'tomorrow',
  'tounge': 'tongue',
  'truely': 'truly',
  'tyrany': 'tyranny',
  'underate': 'underrate',
  'unfortunatly': 'unfortunately',
  'unneccesary': 'unnecessary',
  'useable': 'usable',
  'usefull': 'useful',
  'vaccum': 'vacuum',
  'vegatable': 'vegetable',
  'vehical': 'vehicle',
  'visious': 'vicious',
  'wether': 'whether',
  'wich': 'which',
  'wierd': 'weird',
  'wellfare': 'welfare',
  'wensday': 'Wednesday',
  'wendsday': 'Wednesday',
  'whereever': 'wherever',
  'writting': 'writing',
  'yeild': 'yield',
  'youre': "you're",
  'dont': "don't",
  'wont': "won't",
  'cant': "can't",
  'didnt': "didn't",
  'doesnt': "doesn't",
  'havent': "haven't",
  'hasnt': "hasn't",
  'hadnt': "hadn't",
  'isnt': "isn't",
  'arent': "aren't",
  'wasnt': "wasn't",
  'werent': "weren't",
  'wouldnt': "wouldn't",
  'couldnt': "couldn't",
  'shouldnt': "shouldn't",
  'im': "I'm",
  'ive': "I've",
  'id': "I'd",
  'ill': "I'll",
  'theyre': "they're",
  'theyve': "they've",
  'theyd': "they'd",
  'theyll': "they'll",
  'youve': "you've",
  'youd': "you'd",
  'youll': "you'll",
  'weve': "we've",
  'wed': "we'd",
  'well': "we'll",
  'hes': "he's",
  'shes': "she's",
  'its': "it's",
  'lets': "let's",
  'thats': "that's",
  'whos': "who's",
  'whats': "what's",
  'wheres': "where's",
  'heres': "here's",
  'theres': "there's",
};

export interface CorrectionResult {
  correctedText: string;
  corrections: Array<{
    original: string;
    corrected: string;
    index: number;
  }>;
}

export function autoCorrect(text: string): CorrectionResult {
  const corrections: CorrectionResult['corrections'] = [];
  let correctedText = text;
  
  // Split into words while preserving positions
  const wordRegex = /\b[\w']+\b/g;
  let match;
  const wordsToCheck: Array<{ word: string; index: number }> = [];
  
  while ((match = wordRegex.exec(text)) !== null) {
    wordsToCheck.push({ word: match[0], index: match.index });
  }
  
  // Process words in reverse order to maintain correct indices
  for (let i = wordsToCheck.length - 1; i >= 0; i--) {
    const { word, index } = wordsToCheck[i];
    const lowerWord = word.toLowerCase();
    
    if (CORRECTIONS[lowerWord]) {
      const correctedWord = CORRECTIONS[lowerWord];
      // Preserve original capitalization for first letter
      const finalWord = word[0] === word[0].toUpperCase() 
        ? correctedWord.charAt(0).toUpperCase() + correctedWord.slice(1)
        : correctedWord;
      
      correctedText = correctedText.slice(0, index) + finalWord + correctedText.slice(index + word.length);
      
      corrections.unshift({
        original: word,
        corrected: finalWord,
        index: index,
      });
    }
  }
  
  return { correctedText, corrections };
}

export function getHighlightedText(text: string, corrections: CorrectionResult['corrections']): Array<{ text: string; isCorrected: boolean }> {
  if (corrections.length === 0) {
    return [{ text, isCorrected: false }];
  }
  
  const parts: Array<{ text: string; isCorrected: boolean }> = [];
  let lastIndex = 0;
  
  // Find corrected words in the corrected text
  const correctedWords = corrections.map(c => c.corrected.toLowerCase());
  const words = text.split(/(\s+)/);
  
  for (const segment of words) {
    if (segment.trim() && correctedWords.includes(segment.toLowerCase())) {
      // Check if this word was actually corrected (not just coincidentally matching)
      const correctionIndex = correctedWords.indexOf(segment.toLowerCase());
      if (correctionIndex !== -1) {
        parts.push({ text: segment, isCorrected: true });
        // Remove from list to handle duplicates correctly
        correctedWords.splice(correctionIndex, 1);
      } else {
        parts.push({ text: segment, isCorrected: false });
      }
    } else {
      parts.push({ text: segment, isCorrected: false });
    }
  }
  
  return parts;
}
