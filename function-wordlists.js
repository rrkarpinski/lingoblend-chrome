// function-wordlists.js — LingoBlend 0.6.0
// Loaded before aho-corasick.js and content.js (manifest), and before dashboard.js (dashboard.html).
// DO NOT use ES module imports/exports — assigns directly to window.LB_FW.

window.LB_FW = {

  en: new Set([
    // Articles
    'the','a','an',
    // Prepositions
    'in','on','at','by','for','with','about','to','of','from','into','onto','upon',
    'over','under','above','below','between','among','through','during','before',
    'after','against','along','around','behind','beside','besides','beyond','down',
    'except','inside','near','off','out','outside','past','since','throughout',
    'till','toward','towards','under','underneath','until','up','via','within','without',
    // Conjunctions
    'and','but','or','nor','so','yet','for','both','either','neither','whether',
    'although','because','since','unless','until','while','whereas','though','even',
    'if','when','where','after','before','as','that','than','then','though',
    'once','now','provided','supposing','lest',
    // Pronouns
    'i','me','my','mine','myself',
    'you','your','yours','yourself','yourselves',
    'he','him','his','himself',
    'she','her','hers','herself',
    'it','its','itself',
    'we','us','our','ours','ourselves',
    'they','them','their','theirs','themselves',
    'who','whom','whose','which','what',
    'this','that','these','those',
    'one','ones','someone','anyone','everyone','no one','nobody','somebody','anybody','everybody',
    'something','anything','everything','nothing',
    'each','another','other','others',
    // Auxiliaries & copulas
    'be','am','is','are','was','were','been','being',
    'have','has','had','having',
    'do','does','did','done','doing',
    'will','would','shall','should',
    'may','might','must','can','could',
    'need','dare','ought',
    'get','got','gotten',
    // Determiners & quantifiers
    'some','any','all','both','each','every','no','either','neither',
    'much','many','more','most','few','fewer','little','less','least',
    'several','enough','such','same','other','another',
    'last','next','own',
    // Adverbs (function-word class)
    'not','also','just','only','even','still','yet','already','always','never',
    'often','sometimes','usually','here','there','now','then','very','too',
    'so','rather','quite','almost','nearly','hardly','barely','merely',
    'indeed','perhaps','maybe','however','therefore','thus','hence','otherwise',
    'anyway','instead','else','together','apart','away','back','forward','around',
    'up','down','off','out','in','on','over','again','once','twice',
    // Numbers used pronominally
    'one','two','three',
    // Misc
    'well','like','just','both','whether','whose','whom','whichever','whatever',
    'whoever','however','whenever','wherever','whomever'
  ]),

  pl: new Set([
    // Prepositions
    'w','we','na','do','z','ze','dla','przez','przy','po','przed','nad','pod',
    'za','między','o','od','ku','mimo','według','wokół','poza','obok','naprzeciwko',
    'spod','spośród','sprzed','znad','zza','bez','wzdłuż','podczas','wobec',
    'odnośnie','dotyczące','dokoła','wokoło','wewnątrz','zewnątrz',
    // Conjunctions
    'i','a','ale','lecz','lub','albo','ani','bo','że','czy','jak','kiedy','gdy',
    'jeśli','jeżeli','chociaż','choć','skoro','ponieważ','gdyż','dlatego','więc',
    'zatem','jednak','lecz','toteż','żeby','aby','ażeby','dopóki','dopóty',
    'podczas','zanim','odkąd','skąd','mimo','choćby','byle','byleby',
    // Pronouns
    'ja','ty','on','ona','ono','my','wy','oni','one',
    'mnie','mi','mną','ciebie','cię','tobie','ci','tobą',
    'go','jego','jemu','mu','nim','jej','jej','jej','ją','nią',
    'nas','nam','nami','was','wam','wami','ich','im','nimi',
    'się','sobie','siebie',
    'ten','ta','to','ci','te','tego','tej','temu','tym','tą','tych','tym','tymi',
    'tamten','tamta','tamto','tamci','tamte',
    'kto','co','który','która','które','komu','czemu','kogo','czego',
    'kogoś','coś','ktoś','nic','nikt','wszystko','wszyscy','każdy',
    'każda','każde','żaden','żadna','żadne',
    // Auxiliaries & copulas
    'być','jest','są','był','była','było','byli','były','będzie','będą',
    'będę','będziesz','będziemy','będziecie','byłem','byłam','byłeś','byłaś',
    'byliśmy','byłyśmy','byliście','byłyście','mieć','ma','mają','mam','masz',
    'mamy','macie','miał','miała','miało','mieli','miały','będzie',
    'móc','mogę','możesz','może','możemy','możecie','mogą','mógł','mogła',
    // Determiners & quantifiers
    'jakiś','jakaś','jakieś','żaden','żadna','żadne','każdy','każda','każde',
    'wszystek','cały','całe','całą','parę','kilka','wiele','mało','dużo','więcej',
    'mniej','trochę','nieco','tyle','ile','kilku','kilkoma',
    // Adverbs (function-word class)
    'nie','też','już','jeszcze','zawsze','nigdy','często','rzadko','czasem',
    'zwykle','tutaj','tam','tu','teraz','wtedy','potem','bardzo','też','tylko',
    'nawet','jednak','właśnie','po prostu','właściwie','raczej','prawie','wcale',
    'chyba','może','jednak','zatem','więc','dlatego','ponieważ','skoro',
    'natomiast','tymczasem','zatem','przeto','stąd','stad','tutaj','gdzieś',
    'wszędzie','nigdzie','jak','tak','tak','nie',
    // Numbers used pronominally
    'jeden','jedna','jedno','dwa','dwie','trzy',
    // Misc particles
    'by','by','niby','bodaj','byle','chyba','chociażby','nawet','właśnie','akurat'
  ]),

  es: new Set([
    // Articles
    'el','la','los','las','un','una','unos','unas','lo',
    // Prepositions
    'en','de','a','con','por','para','sin','sobre','entre','hasta','desde',
    'ante','bajo','cabe','contra','durante','hacia','mediante','salvo','según',
    'so','tras','versus','vía',
    // Conjunctions
    'y','e','o','u','ni','pero','sino','mas','aunque','porque','pues','que',
    'como','cuando','si','donde','mientras','aunque','ya que','puesto que',
    'dado que','a menos que','antes de que','después de que','para que',
    'con tal de que','siempre que','a pesar de que',
    // Pronouns
    'yo','tú','él','ella','ello','nosotros','nosotras','vosotros','vosotras',
    'ellos','ellas','usted','ustedes',
    'me','te','se','nos','os','le','les','lo','la','los','las',
    'mí','ti','sí',
    'mi','tu','su','nuestro','nuestra','nuestros','nuestras',
    'vuestro','vuestra','vuestros','vuestras',
    'este','esta','esto','estos','estas',
    'ese','esa','eso','esos','esas',
    'aquel','aquella','aquello','aquellos','aquellas',
    'quien','quienes','cual','cuales','que','cuyo','cuya','cuyos','cuyas',
    'alguien','nadie','algo','nada','todo','todos','todas','cada','cualquier',
    // Auxiliaries & copulas
    'ser','soy','eres','es','somos','sois','son','era','eras','éramos',
    'erais','eran','fui','fuiste','fue','fuimos','fuisteis','fueron',
    'sido','siendo','estar','estoy','estás','está','estamos','estáis','están',
    'estaba','estabas','estuvo','estuvimos','estuvieron','estado','estando',
    'haber','he','has','ha','hemos','habéis','han','había','hubo','habido',
    'tener','tengo','tienes','tiene','tenemos','tenéis','tienen',
    'poder','puedo','puedes','puede','podemos','podéis','pueden',
    'deber','querer','saber','hacer','ir','voy','vas','va','vamos','vais','van',
    // Determiners & quantifiers
    'este','ese','aquel','algún','alguna','ningún','ninguna','otro','otra',
    'otros','otras','mucho','mucha','muchos','muchas','poco','poca','pocos','pocas',
    'todo','toda','todos','todas','tanto','tanta','tantos','tantas','más','menos',
    'bastante','demasiado','varios','varias','cualquier','cada','mismo','misma',
    // Adverbs (function-word class)
    'no','sí','también','tampoco','ya','aún','todavía','siempre','nunca','jamás',
    'aquí','ahí','allí','acá','allá','ahora','entonces','después','antes','muy',
    'bien','mal','así','tan','solo','sólo','incluso','hasta','aún','además',
    'sin embargo','no obstante','por tanto','por lo tanto','por eso','es decir',
    'o sea','quizás','quizá','tal vez','acaso','quizás'
  ])

};
