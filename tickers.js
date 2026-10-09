// tickers.js - Shared public-company sponsor map and therapeutic themes.
// Used by send-report.js (daily digest) and build-pipeline.js (website data).
// Edit this file to add companies. Matching is whole-word, case-insensitive,
// and only against sponsors ClinicalTrials.gov classifies as INDUSTRY.
//
// Format: { ticker: "TICK", names: ["Sponsor name as it appears on CT.gov"], sector: "...", context: "..." }
// Use ticker "PRIVATE" for private companies so they stop showing as candidates.

"use strict";

const COVERAGE = [
  // Med Devices
  { ticker: "DXCM", names: ["Dexcom"],              sector: "Med Devices",   context: "CGM competitive positioning, Stelo OTC, G7/G8 pipeline" },
  { ticker: "PODD", names: ["Insulet"],              sector: "Med Devices",   context: "Omnipod 5/6 automated insulin delivery expansion" },
  { ticker: "TNDM", names: ["Tandem Diabetes"],      sector: "Med Devices",   context: "Mobi pump, Control-IQ algorithm, competitive vs PODD" },
  { ticker: "ABT",  names: ["Abbott"],               sector: "Med Devices",   context: "Libre CGM franchise, structural heart (MitraClip/TriClip), diagnostics" },
  { ticker: "MDT",  names: ["Medtronic"],            sector: "Med Devices",   context: "780G insulin pump, Hugo surgical robot, cardiac rhythm" },
  { ticker: "PRCT", names: ["PROCEPT BioRobotics"],  sector: "Med Devices",   context: "Aquablation therapy for BPH, WATER/WATERJETS data" },
  { ticker: "CVRX", names: ["CVRx"],                 sector: "Med Devices",   context: "Barostim neo, heart failure neuromodulation, CMS coverage" },
  { ticker: "BBNX", names: ["BrainBox"],             sector: "Med Devices",   context: "AI-powered EEG for brain injury assessment" },

  // Healthcare Services
  { ticker: "OPCH", names: ["Option Care", "BioScrip"],  sector: "HC Services",    context: "Home/alternate-site infusion, biosimilar transition tailwind" },
  { ticker: "PACS", names: ["PACS Group"],                sector: "HC Services",    context: "Post-acute/skilled nursing volumes, DOJ overhang" },
  { ticker: "WAY",  names: ["Waystar"],                   sector: "HC Services",    context: "Revenue cycle management, claims automation" },
  { ticker: "OPRX", names: ["OptimizeRx"],                sector: "HC Services",    context: "Digital health messaging, pharma channel" },

  // Dental
  { ticker: "PARK", names: ["Park Dental"],           sector: "Dental",        context: "DSO rollup, VIE structure, Medicaid dental expansion" },

  // Specialty Pharma / LTC
  { ticker: "GRDN", names: ["Guardian Pharmacy"],     sector: "Specialty Pharma", context: "LTC pharmacy, IRA/MFP Part D reimbursement headwind" },

  // Managed Care
  { ticker: "UNH",  names: ["UnitedHealth", "Optum", "UnitedHealthcare"],  sector: "Managed Care", context: "Optum clinical programs, value-based care pilots" },
  { ticker: "ELV",  names: ["Elevance", "Anthem", "Carelon"],              sector: "Managed Care", context: "Carelon services, Medicaid managed care" },
  { ticker: "CNC",  names: ["Centene", "WellCare"],                        sector: "Managed Care", context: "Medicaid MCO, rate adequacy exposure" },
  { ticker: "MOH",  names: ["Molina"],                                     sector: "Managed Care", context: "Medicaid/Medicare dual-eligible focus" },
  { ticker: "CVS",  names: ["CVS Health", "Aetna", "CVS Caremark"],        sector: "Managed Care", context: "Aetna MCO + Caremark PBM + Oak Street primary care" },

  // GLP-1 / Obesity
  { ticker: "LLY",  names: ["Eli Lilly", "Lilly", "Loxo Oncology"],   sector: "GLP-1 / Obesity", context: "Tirzepatide (Mounjaro/Zepbound), orforglipron oral pivot" },
  { ticker: "NVO",  names: ["Novo Nordisk"],                           sector: "GLP-1 / Obesity", context: "Semaglutide (Ozempic/Wegovy), oral sema, amycretin" },

  // Imaging / Diagnostics
  { ticker: "WAT",  names: ["Waters Corporation"],    sector: "Diagnostics",  context: "LC/MS platforms, Wyatt Technology acquisition" },

  // CDMO
  { ticker: "OXB",  names: ["Oxford Biomedica"],      sector: "CDMO",         context: "Gene therapy CDMO, backlog-to-revenue conversion, CMD June 2026" },
];

// ------------------------------------------------------------
//  PUBLIC COMPANY TIER - broad sponsor-name-to-ticker map.
//  This is a starting list written to match how sponsor names appear on
//  ClinicalTrials.gov. Review it, remove what you do not want, and add names
//  from the "Unmapped industry sponsors" section of the email over time.
//  Subsidiaries are listed under the parent. Tickers are the primary US or
//  home-market listing. Companies with a PRIVATE ticker are mapped so they
//  stop showing up as unmapped; change the ticker if they list.
// ------------------------------------------------------------

const PUBLIC_SPONSORS = [
  // Large-cap pharma
  { ticker: "PFE",  names: ["Pfizer", "Seagen"], sector: "Pharma" },
  { ticker: "MRK",  names: ["Merck Sharp & Dohme", "Merck & Co"], sector: "Pharma" },
  { ticker: "MRK.DE", names: ["Merck KGaA", "EMD Serono", "Merck Healthcare"], sector: "Pharma" },
  { ticker: "JNJ",  names: ["Janssen", "Johnson & Johnson", "Ethicon", "Biosense Webster", "Abiomed", "Shockwave Medical", "DePuy Synthes"], sector: "Pharma / Devices" },
  { ticker: "ABBV", names: ["AbbVie", "Allergan"], sector: "Pharma" },
  { ticker: "BMY",  names: ["Bristol-Myers Squibb", "Celgene", "Mirati"], sector: "Pharma" },
  { ticker: "AMGN", names: ["Amgen", "Horizon Therapeutics"], sector: "Pharma" },
  { ticker: "GILD", names: ["Gilead Sciences", "Kite Pharma", "Kite, A Gilead Company"], sector: "Pharma" },
  { ticker: "REGN", names: ["Regeneron"], sector: "Pharma" },
  { ticker: "VRTX", names: ["Vertex Pharmaceuticals"], sector: "Pharma" },
  { ticker: "AZN",  names: ["AstraZeneca", "Alexion"], sector: "Pharma" },
  { ticker: "NVS",  names: ["Novartis"], sector: "Pharma" },
  { ticker: "SDZ",  names: ["Sandoz"], sector: "Pharma" },
  { ticker: "ROG",  names: ["Hoffmann-La Roche", "Roche", "Genentech", "Spark Therapeutics"], sector: "Pharma" },
  { ticker: "4519", names: ["Chugai"], sector: "Pharma" },
  { ticker: "GSK",  names: ["GlaxoSmithKline", "GSK"], sector: "Pharma" },
  { ticker: "SNY",  names: ["Sanofi", "Genzyme", "Sanofi Pasteur"], sector: "Pharma" },
  { ticker: "BIIB", names: ["Biogen"], sector: "Pharma" },
  { ticker: "MRNA", names: ["ModernaTX", "Moderna"], sector: "Pharma" },
  { ticker: "BNTX", names: ["BioNTech"], sector: "Pharma" },
  { ticker: "TAK",  names: ["Takeda", "Shire"], sector: "Pharma" },
  { ticker: "BAYN", names: ["Bayer"], sector: "Pharma" },
  { ticker: "DSNKY", names: ["Daiichi Sankyo"], sector: "Pharma" },
  { ticker: "ALPMY", names: ["Astellas"], sector: "Pharma" },
  { ticker: "ESALY", names: ["Eisai"], sector: "Pharma" },
  { ticker: "OTSKY", names: ["Otsuka"], sector: "Pharma" },
  { ticker: "UCB",  names: ["UCB Biopharma", "UCB Pharma", "UCB"], sector: "Pharma" },
  { ticker: "IPN",  names: ["Ipsen"], sector: "Pharma" },
  { ticker: "HLUN", names: ["H. Lundbeck", "Lundbeck"], sector: "Pharma" },
  { ticker: "TEVA", names: ["Teva"], sector: "Pharma" },
  { ticker: "VTRS", names: ["Viatris", "Mylan"], sector: "Pharma" },
  { ticker: "OGN",  names: ["Organon"], sector: "Pharma" },
  { ticker: "BHC",  names: ["Bausch Health"], sector: "Pharma" },
  { ticker: "BLCO", names: ["Bausch + Lomb", "Bausch & Lomb"], sector: "Pharma / Devices" },
  { ticker: "PRIVATE", names: ["Boehringer Ingelheim", "Servier", "Grunenthal", "Menarini", "Chiesi", "Ferring", "Octapharma", "CSL Behring", "Mundipharma", "Purdue Pharma"], sector: "Private" },
  { ticker: "CSL",  names: ["CSL Limited", "Seqirus"], sector: "Pharma" },

  // Mid and small-cap biopharma
  { ticker: "ALNY", names: ["Alnylam"], sector: "Biopharma" },
  { ticker: "INCY", names: ["Incyte"], sector: "Biopharma" },
  { ticker: "JAZZ", names: ["Jazz Pharmaceuticals"], sector: "Biopharma" },
  { ticker: "NBIX", names: ["Neurocrine"], sector: "Biopharma" },
  { ticker: "SRPT", names: ["Sarepta"], sector: "Biopharma" },
  { ticker: "BMRN", names: ["BioMarin"], sector: "Biopharma" },
  { ticker: "EXEL", names: ["Exelixis"], sector: "Biopharma" },
  { ticker: "IONS", names: ["Ionis"], sector: "Biopharma" },
  { ticker: "INSM", names: ["Insmed"], sector: "Biopharma" },
  { ticker: "UTHR", names: ["United Therapeutics"], sector: "Biopharma" },
  { ticker: "ARGX", names: ["argenx"], sector: "Biopharma" },
  { ticker: "NVAX", names: ["Novavax"], sector: "Biopharma" },
  { ticker: "HALO", names: ["Halozyme"], sector: "Biopharma" },
  { ticker: "APLS", names: ["Apellis"], sector: "Biopharma" },
  { ticker: "CYTK", names: ["Cytokinetics"], sector: "Biopharma" },
  { ticker: "MDGL", names: ["Madrigal"], sector: "Biopharma" },
  { ticker: "ACAD", names: ["Acadia Pharmaceuticals", "ACADIA Pharmaceuticals"], sector: "Biopharma" },
  { ticker: "AXSM", names: ["Axsome"], sector: "Biopharma" },
  { ticker: "RARE", names: ["Ultragenyx"], sector: "Biopharma" },
  { ticker: "ARVN", names: ["Arvinas"], sector: "Biopharma" },
  { ticker: "RVMD", names: ["Revolution Medicines"], sector: "Biopharma" },
  { ticker: "IMVT", names: ["Immunovant"], sector: "Biopharma" },
  { ticker: "KRYS", names: ["Krystal Biotech"], sector: "Biopharma" },
  { ticker: "BBIO", names: ["BridgeBio"], sector: "Biopharma" },
  { ticker: "VKTX", names: ["Viking Therapeutics"], sector: "Biopharma" },
  { ticker: "SMMT", names: ["Summit Therapeutics"], sector: "Biopharma" },
  { ticker: "LEGN", names: ["Legend Biotech"], sector: "Biopharma" },
  { ticker: "RYTM", names: ["Rhythm Pharmaceuticals"], sector: "Biopharma" },
  { ticker: "ALKS", names: ["Alkermes"], sector: "Biopharma" },
  { ticker: "IRON", names: ["Disc Medicine"], sector: "Biopharma" },
  { ticker: "PCVX", names: ["Vaxcyte"], sector: "Biopharma" },
  { ticker: "ROIV", names: ["Roivant"], sector: "Biopharma" },
  { ticker: "SWTX", names: ["SpringWorks"], sector: "Biopharma" },
  { ticker: "AMRX", names: ["Amneal"], sector: "Biopharma" },
  { ticker: "PBH",  names: ["Prestige Consumer"], sector: "Biopharma" },
  { ticker: "SUPN", names: ["Supernus"], sector: "Biopharma" },
  { ticker: "CORT", names: ["Corcept"], sector: "Biopharma" },
  { ticker: "HRMY", names: ["Harmony Biosciences"], sector: "Biopharma" },
  { ticker: "PTCT", names: ["PTC Therapeutics"], sector: "Biopharma" },
  { ticker: "IOVA", names: ["Iovance"], sector: "Biopharma" },
  { ticker: "DNLI", names: ["Denali Therapeutics"], sector: "Biopharma" },
  { ticker: "XENE", names: ["Xenon Pharmaceuticals"], sector: "Biopharma" },
  { ticker: "MNKD", names: ["MannKind"], sector: "Biopharma" },
  { ticker: "ZLAB", names: ["Zai Lab"], sector: "Biopharma" },
  { ticker: "BGNE", names: ["BeiGene", "BeOne Medicines"], sector: "Biopharma" },
  { ticker: "HCM",  names: ["Hutchmed"], sector: "Biopharma" },
  { ticker: "4151", names: ["Kyowa Kirin"], sector: "Biopharma" },
  { ticker: "4528", names: ["Ono Pharmaceutical"], sector: "Biopharma" },
  { ticker: "4507", names: ["Shionogi"], sector: "Biopharma" },
  { ticker: "4536", names: ["Santen"], sector: "Biopharma" },
  { ticker: "128940", names: ["Hanmi Pharmaceutical"], sector: "Biopharma" },
  { ticker: "207940", names: ["Samsung Bioepis", "Samsung Biologics"], sector: "Biopharma / CDMO" },
  { ticker: "068270", names: ["Celltrion"], sector: "Biopharma" },
  { ticker: "SUNPHARMA", names: ["Sun Pharma", "Sun Pharmaceutical"], sector: "Biopharma" },
  { ticker: "DRREDDY", names: ["Dr. Reddy's", "Dr Reddy's"], sector: "Biopharma" },
  { ticker: "CIPLA", names: ["Cipla"], sector: "Biopharma" },
  { ticker: "LUPIN", names: ["Lupin"], sector: "Biopharma" },
  { ticker: "ZYDUSLIFE", names: ["Zydus", "Cadila"], sector: "Biopharma" },
  { ticker: "GLENMARK", names: ["Glenmark"], sector: "Biopharma" },
  { ticker: "600276", names: ["Jiangsu HengRui", "Hengrui"], sector: "Biopharma" },
  { ticker: "1801", names: ["Innovent"], sector: "Biopharma" },
  { ticker: "9926", names: ["Akeso"], sector: "Biopharma" },

  // Medical devices
  { ticker: "BSX",  names: ["Boston Scientific", "Axonics", "Silk Road Medical"], sector: "Med Devices" },
  { ticker: "SYK",  names: ["Stryker", "Inari Medical"], sector: "Med Devices" },
  { ticker: "EW",   names: ["Edwards Lifesciences"], sector: "Med Devices" },
  { ticker: "ISRG", names: ["Intuitive Surgical"], sector: "Med Devices" },
  { ticker: "ZBH",  names: ["Zimmer Biomet", "Zimmer", "Biomet"], sector: "Med Devices" },
  { ticker: "BDX",  names: ["Becton, Dickinson", "Becton Dickinson", "C. R. Bard", "Bard"], sector: "Med Devices" },
  { ticker: "PEN",  names: ["Penumbra"], sector: "Med Devices" },
  { ticker: "INSP", names: ["Inspire Medical"], sector: "Med Devices" },
  { ticker: "IRTC", names: ["iRhythm"], sector: "Med Devices" },
  { ticker: "GKOS", names: ["Glaukos"], sector: "Med Devices" },
  { ticker: "GMED", names: ["Globus Medical", "NuVasive", "Nevro"], sector: "Med Devices" },
  { ticker: "TFX",  names: ["Teleflex"], sector: "Med Devices" },
  { ticker: "HOLX", names: ["Hologic"], sector: "Med Devices" },
  { ticker: "MASI", names: ["Masimo"], sector: "Med Devices" },
  { ticker: "RMD",  names: ["ResMed"], sector: "Med Devices" },
  { ticker: "ALGN", names: ["Align Technology"], sector: "Dental" },
  { ticker: "XRAY", names: ["Dentsply Sirona", "Dentsply"], sector: "Dental" },
  { ticker: "NVST", names: ["Envista", "Nobel Biocare", "Ormco"], sector: "Dental" },
  { ticker: "STMN", names: ["Straumann"], sector: "Dental" },
  { ticker: "NVCR", names: ["NovoCure"], sector: "Med Devices" },
  { ticker: "IART", names: ["Integra LifeSciences"], sector: "Med Devices" },
  { ticker: "HAE",  names: ["Haemonetics"], sector: "Med Devices" },
  { ticker: "LIVN", names: ["LivaNova"], sector: "Med Devices" },
  { ticker: "MMSI", names: ["Merit Medical"], sector: "Med Devices" },
  { ticker: "LNTH", names: ["Lantheus"], sector: "Med Devices / Diagnostics" },
  { ticker: "TMDX", names: ["TransMedics"], sector: "Med Devices" },
  { ticker: "ATRC", names: ["AtriCure"], sector: "Med Devices" },
  { ticker: "ATEC", names: ["Alphatec"], sector: "Med Devices" },
  { ticker: "SIBN", names: ["SI-BONE"], sector: "Med Devices" },
  { ticker: "OM",   names: ["Outset Medical"], sector: "Med Devices" },
  { ticker: "RXST", names: ["RxSight"], sector: "Med Devices" },
  { ticker: "STAA", names: ["STAAR Surgical"], sector: "Med Devices" },
  { ticker: "LUNG", names: ["Pulmonx"], sector: "Med Devices" },
  { ticker: "ESTA", names: ["Establishment Labs"], sector: "Med Devices" },
  { ticker: "AORT", names: ["Artivion"], sector: "Med Devices" },
  { ticker: "ANGO", names: ["AngioDynamics"], sector: "Med Devices" },
  { ticker: "LMAT", names: ["LeMaitre"], sector: "Med Devices" },
  { ticker: "ICUI", names: ["ICU Medical"], sector: "Med Devices" },
  { ticker: "EMBC", names: ["Embecta"], sector: "Med Devices" },
  { ticker: "BAX",  names: ["Baxter"], sector: "Med Devices" },
  { ticker: "STE",  names: ["STERIS"], sector: "Med Devices" },
  { ticker: "COO",  names: ["CooperCompanies", "CooperVision", "CooperSurgical"], sector: "Med Devices" },
  { ticker: "GEHC", names: ["GE HealthCare", "GE Healthcare"], sector: "Med Devices / Imaging" },
  { ticker: "PHG",  names: ["Philips"], sector: "Med Devices / Imaging" },
  { ticker: "SHL",  names: ["Siemens Healthineers", "Siemens Healthcare"], sector: "Med Devices / Imaging" },
  { ticker: "OFIX", names: ["Orthofix"], sector: "Med Devices" },
  { ticker: "ENOV", names: ["Enovis"], sector: "Med Devices" },
  { ticker: "CNMD", names: ["CONMED"], sector: "Med Devices" },
  { ticker: "AXGN", names: ["Axogen"], sector: "Med Devices" },
  { ticker: "BLFS", names: ["BioLife Solutions"], sector: "Med Devices" },
  { ticker: "NUVB", names: ["Nuvation Bio"], sector: "Biopharma" },
  { ticker: "SENS", names: ["Senseonics"], sector: "Med Devices" },
  { ticker: "BFLY", names: ["Butterfly Network"], sector: "Med Devices / Imaging" },
  { ticker: "NNOX", names: ["Nano-X"], sector: "Med Devices / Imaging" },
  { ticker: "ABT",  names: ["St. Jude Medical"], sector: "Med Devices" },
  { ticker: "MDT",  names: ["Covidien", "Mazor Robotics"], sector: "Med Devices" },

  // Diagnostics, tools, life science
  { ticker: "EXAS", names: ["Exact Sciences"], sector: "Diagnostics" },
  { ticker: "NTRA", names: ["Natera"], sector: "Diagnostics" },
  { ticker: "GH",   names: ["Guardant Health"], sector: "Diagnostics" },
  { ticker: "DGX",  names: ["Quest Diagnostics"], sector: "Diagnostics" },
  { ticker: "LH",   names: ["Labcorp", "Laboratory Corporation of America", "Covance"], sector: "Diagnostics / CRO" },
  { ticker: "TEM",  names: ["Tempus"], sector: "Diagnostics" },
  { ticker: "VCYT", names: ["Veracyte"], sector: "Diagnostics" },
  { ticker: "MYGN", names: ["Myriad Genetics"], sector: "Diagnostics" },
  { ticker: "ILMN", names: ["Illumina", "GRAIL"], sector: "Tools / Diagnostics" },
  { ticker: "TMO",  names: ["Thermo Fisher", "PPD"], sector: "Tools / CRO" },
  { ticker: "DHR",  names: ["Danaher", "Cepheid", "Beckman Coulter", "Leica Biosystems"], sector: "Tools / Diagnostics" },
  { ticker: "A",    names: ["Agilent"], sector: "Tools" },
  { ticker: "BRKR", names: ["Bruker"], sector: "Tools" },
  { ticker: "RVTY", names: ["Revvity", "PerkinElmer"], sector: "Tools" },
  { ticker: "QDEL", names: ["QuidelOrtho", "Quidel"], sector: "Diagnostics" },
  { ticker: "BIO",  names: ["Bio-Rad"], sector: "Tools" },
  { ticker: "PACB", names: ["Pacific Biosciences"], sector: "Tools" },
  { ticker: "TXG",  names: ["10x Genomics"], sector: "Tools" },
  { ticker: "NEOG", names: ["Neogen"], sector: "Diagnostics" },
  { ticker: "BMX",  names: ["bioMerieux"], sector: "Diagnostics" },
  { ticker: "QGEN", names: ["QIAGEN"], sector: "Diagnostics" },
  { ticker: "OSUR", names: ["OraSure"], sector: "Diagnostics" },
  { ticker: "CSTL", names: ["Castle Biosciences"], sector: "Diagnostics" },

  // CROs and CDMOs
  { ticker: "IQV",  names: ["IQVIA"], sector: "CRO" },
  { ticker: "ICLR", names: ["ICON plc", "ICON Clinical"], sector: "CRO" },
  { ticker: "MEDP", names: ["Medpace"], sector: "CRO" },
  { ticker: "FTRE", names: ["Fortrea"], sector: "CRO" },
  { ticker: "CRL",  names: ["Charles River"], sector: "CRO" },
  { ticker: "SYNH", names: ["Syneos"], sector: "CRO" },
  { ticker: "LONN", names: ["Lonza"], sector: "CDMO" },
  { ticker: "EVO",  names: ["Evotec"], sector: "CDMO" },
  { ticker: "2269", names: ["WuXi Biologics"], sector: "CDMO" },
  { ticker: "2359", names: ["WuXi AppTec"], sector: "CDMO / CRO" },
  { ticker: "SRT3", names: ["Sartorius"], sector: "Tools" },
  { ticker: "WST",  names: ["West Pharmaceutical"], sector: "Packaging" },

  // Healthcare services (these sponsor fewer studies, but it matters when they do)
  { ticker: "HCA",  names: ["HCA Healthcare", "Sarah Cannon"], sector: "HC Services" },
  { ticker: "THC",  names: ["Tenet Healthcare", "Tenet"], sector: "HC Services" },
  { ticker: "UHS",  names: ["Universal Health Services"], sector: "HC Services" },
  { ticker: "CYH",  names: ["Community Health Systems"], sector: "HC Services" },
  { ticker: "EHC",  names: ["Encompass Health"], sector: "HC Services" },
  { ticker: "ENSG", names: ["Ensign Group"], sector: "HC Services" },
  { ticker: "ADUS", names: ["Addus HomeCare"], sector: "HC Services" },
  { ticker: "AVAH", names: ["Aveanna"], sector: "HC Services" },
  { ticker: "AMED", names: ["Amedisys"], sector: "HC Services" },
  { ticker: "EHAB", names: ["Enhabit"], sector: "HC Services" },
  { ticker: "LFST", names: ["LifeStance"], sector: "HC Services" },
  { ticker: "ACHC", names: ["Acadia Healthcare"], sector: "HC Services" },
  { ticker: "DVA",  names: ["DaVita"], sector: "HC Services" },
  { ticker: "FMS",  names: ["Fresenius Medical Care"], sector: "HC Services" },
  { ticker: "FRE",  names: ["Fresenius Kabi"], sector: "Pharma" },
  { ticker: "SGRY", names: ["Surgery Partners"], sector: "HC Services" },
  { ticker: "RDNT", names: ["RadNet"], sector: "HC Services" },
  { ticker: "AGL",  names: ["agilon health", "agilon"], sector: "HC Services" },
  { ticker: "ASTH", names: ["Astrana Health", "Apollo Medical"], sector: "HC Services" },
  { ticker: "PRVA", names: ["Privia Health"], sector: "HC Services" },
  { ticker: "TDOC", names: ["Teladoc", "Livongo"], sector: "HC Services" },
  { ticker: "HIMS", names: ["Hims & Hers"], sector: "HC Services" },
  { ticker: "CON",  names: ["Concentra"], sector: "HC Services" },
  { ticker: "AMN",  names: ["AMN Healthcare"], sector: "HC Services" },
  { ticker: "CHE",  names: ["VITAS", "Chemed"], sector: "HC Services" },
  { ticker: "PNTG", names: ["Pennant Group"], sector: "HC Services" },
  { ticker: "BKD",  names: ["Brookdale Senior Living", "Brookdale"], sector: "HC Services" },
  { ticker: "BTSG", names: ["BrightSpring"], sector: "HC Services" },
  { ticker: "HUM",  names: ["Humana", "CenterWell"], sector: "Managed Care" },
  { ticker: "CI",   names: ["Cigna", "Evernorth", "Express Scripts"], sector: "Managed Care" },
  { ticker: "OSCR", names: ["Oscar Health"], sector: "Managed Care" },
  { ticker: "ALHC", names: ["Alignment Healthcare"], sector: "Managed Care" },
];

// ------------------------------------------------------------
//  THERAPEUTIC-AREA WATCHLIST
//  Matched against conditions and intervention names, lowercase substring.
//  Tags competitor activity regardless of sponsor. Edit freely.
// ------------------------------------------------------------

const THEMES = [
  { label: "GLP-1 / Obesity",            terms: ["obesity", "overweight", "weight management", "glp-1", "glp1", "semaglutide", "tirzepatide", "retatrutide", "orforglipron", "survodutide", "cagrilintide", "amycretin", "mazdutide"] },
  { label: "Alzheimer's / Neuro",        terms: ["alzheimer", "amyloid", "donanemab", "lecanemab", "remternetug"] },
  { label: "Type 1 diabetes / Insulin delivery", terms: ["type 1 diabetes", "type1 diabetes", "insulin pump", "continuous glucose", "automated insulin", "closed loop", "closed-loop"] },
  { label: "Kidney disease / Dialysis",  terms: ["chronic kidney disease", "dialysis", "end stage renal", "end-stage renal", "esrd", "esKD", "hemodialysis", "iga nephropathy"] },
  { label: "Heart failure",              terms: ["heart failure"] },
  { label: "Structural heart",           terms: ["mitral regurgitation", "tricuspid regurgitation", "aortic stenosis", "transcatheter", "tavr", "teer"] },
  { label: "Sleep apnea",                terms: ["sleep apnea", "sleep apnoea", "obstructive sleep"] },
  { label: "BPH / Urology",              terms: ["benign prostatic hyperplasia", "bph", "overactive bladder"] },
  { label: "Behavioral health",          terms: ["major depressive", "depression", "schizophrenia", "bipolar", "opioid use disorder", "alcohol use disorder", "ptsd", "post-traumatic"] },
  { label: "Home infusion / IG",         terms: ["immunoglobulin", "home infusion", "subcutaneous immunoglobulin"] },
  { label: "MASH / Liver",               terms: ["mash", "nash", "steatohepatitis", "resmetirom"] },
  { label: "Oncology (lung)",            terms: ["non-small cell lung", "nsclc", "small cell lung"] },
];


const TICKER_MAP = COVERAGE.map(function (c) { return Object.assign({ coverage: true }, c); })
  .concat(PUBLIC_SPONSORS.map(function (c) { return Object.assign({ coverage: false, context: "" }, c); }));

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const COMPILED_MAP = TICKER_MAP.map(function (entry) {
  return { entry: entry, patterns: entry.names.map(function (n) { return new RegExp("\\b" + escRe(n.toLowerCase()) + "\\b"); }) };
});

// names: [{ name, role }] already filtered to INDUSTRY class. Returns the first matching entry.
function matchNames(names) {
  for (var n = 0; n < names.length; n++) {
    var lower = (names[n].name || "").toLowerCase();
    for (var i = 0; i < COMPILED_MAP.length; i++) {
      var pats = COMPILED_MAP[i].patterns;
      for (var j = 0; j < pats.length; j++) {
        if (pats[j].test(lower)) {
          var e = COMPILED_MAP[i].entry;
          return { ticker: e.ticker, sector: e.sector, context: e.context, coverage: e.coverage, matchedName: names[n].name, role: names[n].role };
        }
      }
    }
  }
  return null;
}

module.exports = { COVERAGE: COVERAGE, PUBLIC_SPONSORS: PUBLIC_SPONSORS, THEMES: THEMES, TICKER_MAP: TICKER_MAP, matchNames: matchNames };
