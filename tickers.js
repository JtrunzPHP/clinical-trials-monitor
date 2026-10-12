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

  // ------------------------------------------------------------
  //  ADDED 2026-10-09 from the first candidates.csv (top ~560 by ongoing trials).
  //  Mapped from Claude's knowledge, NOT individually verified against company IR pages.
  //  Entries whose comment ends in CHECK carry known uncertainty (listing status or recent M&A).
  //  Subsidiaries are mapped to the listed parent. PRIVATE = private, nonprofit or JV.
  // ------------------------------------------------------------
  { ticker: "GSK", names: ["ViiV Healthcare", "Tesaro"], sector: "Pharma" },
  { ticker: "AZN", names: ["Acerta Pharma", "MedImmune"], sector: "Pharma" },
  { ticker: "JNJ", names: ["Aragon Pharmaceuticals", "Intra-Cellular Therapies", "Actelion", "DePuy Orthopaedics", "DePuy"], sector: "Pharma / Devices" },
  { ticker: "BMY", names: ["Karuna Therapeutics", "RayzeBio"], sector: "Pharma" },
  { ticker: "LLY", names: ["Prevail Therapeutics"], sector: "Pharma" },
  { ticker: "SNY", names: ["Blueprint Medicines"], sector: "Pharma" },
  { ticker: "OTSKY", names: ["Taiho Oncology", "Taiho Pharmaceutical", "ReCor Medical"], sector: "Pharma" },
  { ticker: "4528", names: ["Deciphera"], sector: "Pharma" },  // Ono Pharmaceutical (TSE)
  { ticker: "BAYN", names: ["AskBio"], sector: "Pharma" },
  { ticker: "LH", names: ["Sequenom"], sector: "Diagnostics" },
  { ticker: "DHR", names: ["Radiometer Medical"], sector: "Diagnostics" },
  { ticker: "TMO", names: ["PPD Development"], sector: "CRO" },
  { ticker: "COLO-B", names: ["Coloplast", "Kerecis"], sector: "Med Devices" },  // Coloplast (Copenhagen)
  { ticker: "ENOV", names: ["Limacorporate"], sector: "Med Devices" },  // acquired by Enovis 2024
  { ticker: "3407", names: ["Zoll Medical"], sector: "Med Devices" },  // Asahi Kasei (TSE)
  { ticker: "4543", names: ["Microvention-Terumo", "MicroVention", "Terumo"], sector: "Med Devices" },  // Terumo (TSE)
  { ticker: "1177", names: ["Chia Tai Tianqing", "Nanjing Chia-tai Tianqing", "Sino Biopharmaceutical"], sector: "Pharma" },  // Sino Biopharmaceutical (HKEX)
  { ticker: "600276", names: ["Suzhou Suncadia", "Shandong Suncadia", "Beijing Suncadia", "Chengdu Suncadia", "Fujian Shengdi", "Shanghai Shengdi"], sector: "Pharma" },  // Jiangsu Hengrui subsidiaries (SSE)
  { ticker: "1093", names: ["CSPC ZhongQi", "CSPC Megalith", "CSPC Zhongnuo", "CSPC Ouyi", "CSPC"], sector: "Pharma" },  // CSPC Pharmaceutical (HKEX)
  { ticker: "3692", names: ["Jiangsu Hansoh", "Hansoh BioMedical", "Hansoh"], sector: "Pharma" },  // Hansoh Pharmaceutical (HKEX)
  { ticker: "0853", names: ["MicroPort Orthopedics", "Shanghai MicroPort EP", "MicroPort CRM", "MicroPort"], sector: "Med Devices" },  // MicroPort Scientific (HKEX); CardioFlow is separately listed
  { ticker: "2160", names: ["Shanghai MicroPort CardioFlow"], sector: "Med Devices" },  // MicroPort CardioFlow (HKEX)
  { ticker: "1530", names: ["Shenyang Sunshine Pharmaceutical", "3SBio"], sector: "Pharma" },  // 3SBio (HKEX)
  { ticker: "688336", names: ["Sunshine Guojian"], sector: "Pharma" },  // Sunshine Guojian (SSE STAR, 3SBio subsidiary)
  { ticker: "0460", names: ["Xuanzhu Biopharmaceutical"], sector: "Pharma" },  // Sihuan Pharmaceutical (HKEX)
  { ticker: "002422", names: ["Hunan Kelun", "Sichuan Kelun Pharmaceutical"], sector: "Pharma" },  // Kelun Pharmaceutical (SZSE)
  { ticker: "6990", names: ["Sichuan Kelun-Biotech", "Kelun-Biotech"], sector: "Pharma" },  // Kelun-Biotech (HKEX)
  { ticker: "000661", names: ["Changchun GeneScience"], sector: "Pharma" },  // Changchun High & New Technology (SZSE)
  { ticker: "000963", names: ["Hangzhou Zhongmei Huadong", "Huadong Medicine"], sector: "Pharma" },  // Huadong Medicine (SZSE)
  { ticker: "600196", names: ["Shanghai Fosun Pharmaceutical", "Fosun Pharma"], sector: "Pharma" },  // Fosun Pharma (SSE / HKEX 2196)
  { ticker: "2696", names: ["Shanghai Henlius", "Henlius"], sector: "Pharma" },  // Henlius (HKEX)
  { ticker: "688506", names: ["Sichuan Baili"], sector: "Pharma" },  // Baili-Tianheng (SSE STAR)
  { ticker: "002653", names: ["Haisco"], sector: "Pharma" },  // Haisco (SZSE)
  { ticker: "9995", names: ["RemeGen"], sector: "Pharma" },  // RemeGen (HKEX / SSE STAR 688331)
  { ticker: "688520", names: ["Sinocelltech"], sector: "Pharma" },  // SSE STAR
  { ticker: "9969", names: ["Beijing InnoCare", "InnoCare"], sector: "Pharma" },  // InnoCare (HKEX / SSE STAR 688428)
  { ticker: "2162", names: ["Keymed Biosciences"], sector: "Pharma" },  // HKEX
  { ticker: "603087", names: ["Gan & Lee"], sector: "Pharma" },  // SSE
  { ticker: "688266", names: ["Suzhou Zelgen", "Zelgen"], sector: "Pharma" },  // SSE STAR
  { ticker: "688192", names: ["Dizal"], sector: "Pharma" },  // SSE STAR
  { ticker: "2096", names: ["Jiangsu Simcere", "Simcere"], sector: "Pharma" },  // Simcere (HKEX)
  { ticker: "002294", names: ["Shenzhen Salubris", "Salubris"], sector: "Pharma" },  // SZSE
  { ticker: "9966", names: ["Jiangsu Alphamab", "Suzhou Alphamab", "Alphamab"], sector: "Pharma" },  // Alphamab Oncology (HKEX)
  { ticker: "300558", names: ["Betta Pharmaceuticals"], sector: "Pharma" },  // SZSE
  { ticker: "2157", names: ["Lepu Biopharma"], sector: "Pharma" },  // HKEX
  { ticker: "2186", names: ["Luye Pharma"], sector: "Pharma" },  // HKEX
  { ticker: "601607", names: ["Shanghai Pharmaceuticals Holding"], sector: "Pharma" },  // SSE / HKEX 2607
  { ticker: "600535", names: ["Tasly"], sector: "Pharma" },  // SSE
  { ticker: "1558", names: ["Sunshine Lake Pharma", "HEC Pharm"], sector: "Pharma" },  // YiChang HEC (HKEX)
  { ticker: "6185", names: ["CanSino"], sector: "Pharma" },  // HKEX / SSE STAR 688185
  { ticker: "6855", names: ["Ascentage"], sector: "Pharma" },  // HKEX / Nasdaq AAPG
  { ticker: "688062", names: ["Mabwell"], sector: "Pharma" },  // SSE STAR
  { ticker: "2256", names: ["Abbisko"], sector: "Pharma" },  // HKEX
  { ticker: "SVA", names: ["Sinovac"], sector: "Pharma" },  // Sinovac Biotech (Nasdaq; trading status to confirm) CHECK
  { ticker: "688578", names: ["Allist Pharmaceuticals"], sector: "Pharma" },  // SSE STAR
  { ticker: "688321", names: ["Chipscreen"], sector: "Pharma" },  // SSE STAR
  { ticker: "688166", names: ["BrightGene"], sector: "Pharma" },  // SSE STAR
  { ticker: "688177", names: ["Bio-Thera"], sector: "Pharma" },  // SSE STAR
  { ticker: "2171", names: ["CARsgen"], sector: "Pharma" },  // HKEX
  { ticker: "6622", names: ["Zhaoke (Guangzhou) Ophthalmology", "Zhaoke Ophthalmology"], sector: "Pharma" },  // HKEX
  { ticker: "2616", names: ["CStone"], sector: "Pharma" },  // HKEX
  { ticker: "600380", names: ["Joincare"], sector: "Pharma" },  // SSE
  { ticker: "300122", names: ["Anhui Zhifei", "Zhifei"], sector: "Pharma" },  // SZSE
  { ticker: "0950", names: ["Lee's Pharmaceutical"], sector: "Pharma" },  // HKEX
  { ticker: "1167", names: ["Jacobio"], sector: "Pharma" },  // HKEX
  { ticker: "002773", names: ["Chengdu Kanghong", "Kanghong"], sector: "Pharma" },  // SZSE
  { ticker: "1302", names: ["Lifetech Scientific"], sector: "Med Devices" },  // HKEX
  { ticker: "1877", names: ["Junshi"], sector: "Pharma" },  // HKEX
  { ticker: "1952", names: ["Everest Medicines"], sector: "Pharma" },  // HKEX
  { ticker: "2142", names: ["HBM Holdings", "Harbour BioMed"], sector: "Pharma" },  // HKEX
  { ticker: "1349", names: ["Shanghai Fudan-Zhangjiang"], sector: "Pharma" },  // HKEX CHECK
  { ticker: "002007", names: ["Hualan Biological"], sector: "Pharma" },  // SZSE
  { ticker: "600867", names: ["Tonghua Dongbao"], sector: "Pharma" },  // SSE
  { ticker: "1875", names: ["TOT Biopharm"], sector: "Pharma" },  // HKEX CHECK
  { ticker: "3933", names: ["United Laboratories", "The United Bio-Technology"], sector: "Pharma" },  // United Laboratories (HKEX) CHECK
  { ticker: "069620", names: ["Daewoong"], sector: "Pharma" },  // KRX
  { ticker: "003850", names: ["Boryung"], sector: "Pharma" },  // KRX
  { ticker: "185750", names: ["Chong Kun Dang"], sector: "Pharma" },  // KRX
  { ticker: "195940", names: ["HK inno.N"], sector: "Pharma" },  // KOSDAQ
  { ticker: "170900", names: ["Dong-A ST"], sector: "Pharma" },  // KRX
  { ticker: "000100", names: ["Yuhan"], sector: "Pharma" },  // KRX
  { ticker: "006280", names: ["GC Biopharma", "Green Cross"], sector: "Pharma" },  // KRX
  { ticker: "001060", names: ["JW Pharmaceutical"], sector: "Pharma" },  // KRX
  { ticker: "051910", names: ["LG Chem"], sector: "Pharma / Chemicals" },  // KRX
  { ticker: "003220", names: ["Daewon Pharmaceutical"], sector: "Pharma" },  // KRX
  { ticker: "007570", names: ["Il-Yang"], sector: "Pharma" },  // KRX
  { ticker: "243070", names: ["Huons"], sector: "Pharma" },  // KOSDAQ
  { ticker: "005690", names: ["Pharmicell"], sector: "Pharma" },  // KRX
  { ticker: "326030", names: ["SK Bioscience"], sector: "Pharma" },  // KRX
  { ticker: "302440", names: ["SK Biopharmaceuticals"], sector: "Pharma" },  // KRX
  { ticker: "4506", names: ["Sumitomo Pharma"], sector: "Pharma" },  // TSE
  { ticker: "4552", names: ["JCR Pharmaceuticals"], sector: "Pharma" },  // TSE
  { ticker: "4547", names: ["Kissei"], sector: "Pharma" },  // TSE
  { ticker: "7733", names: ["Olympus"], sector: "Med Devices" },  // TSE
  { ticker: "6849", names: ["Nihon Kohden"], sector: "Med Devices" },  // TSE
  { ticker: "4118", names: ["Kaneka"], sector: "Med Devices / Chemicals" },  // TSE
  { ticker: "4519", names: ["Chugai Pharmaceutical"], sector: "Pharma" },  // TSE
  { ticker: "4530", names: ["Hisamitsu"], sector: "Pharma" },  // TSE
  { ticker: "4540", names: ["Tsumura"], sector: "Pharma" },  // TSE
  { ticker: "4569", names: ["Kyorin"], sector: "Pharma" },  // TSE
  { ticker: "4581", names: ["Taisho Pharmaceutical"], sector: "Pharma" },  // Taisho went private in 2024; keep for history CHECK
  { ticker: "4587", names: ["PeptiDream"], sector: "Pharma" },  // TSE
  { ticker: "4565", names: ["Nxera", "Sosei"], sector: "Pharma" },  // TSE
  { ticker: "GMAB", names: ["Genmab"], sector: "Pharma" },  // Nasdaq / Copenhagen
  { ticker: "SOBI", names: ["Swedish Orphan Biovitrum", "Sobi"], sector: "Pharma" },  // Stockholm
  { ticker: "ZEAL", names: ["Zealand Pharma"], sector: "Pharma" },  // Copenhagen
  { ticker: "ASND", names: ["Ascendis"], sector: "Pharma" },  // Nasdaq
  { ticker: "BAVA", names: ["Bavarian Nordic"], sector: "Pharma" },  // Copenhagen
  { ticker: "PHARM", names: ["Pharming"], sector: "Pharma" },  // Euronext Amsterdam / Nasdaq PHAR
  { ticker: "IDIA", names: ["Idorsia"], sector: "Pharma" },  // SIX
  { ticker: "IMCR", names: ["Immunocore"], sector: "Pharma" },  // Nasdaq
  { ticker: "AUTL", names: ["Autolus"], sector: "Pharma" },  // Nasdaq
  { ticker: "ALM", names: ["Almirall"], sector: "Pharma" },  // Madrid
  { ticker: "PHM", names: ["PharmaMar"], sector: "Pharma" },  // Madrid
  { ticker: "REC", names: ["RECORDATI", "Recordati"], sector: "Pharma" },  // Milan
  { ticker: "BSLN", names: ["Basilea"], sector: "Pharma" },  // SIX
  { ticker: "ABVX", names: ["Abivax"], sector: "Pharma" },  // Euronext Paris / Nasdaq
  { ticker: "VLA", names: ["Valneva"], sector: "Pharma" },  // Euronext Paris / Nasdaq
  { ticker: "GALD", names: ["Galderma"], sector: "Pharma" },  // SIX
  { ticker: "ALC", names: ["Alcon"], sector: "Med Devices" },  // NYSE / SIX
  { ticker: "SN", names: ["Smith & Nephew"], sector: "Med Devices" },  // LSE
  { ticker: "CTEC", names: ["ConvaTec"], sector: "Med Devices" },  // LSE
  { ticker: "HLN", names: ["HALEON", "Haleon"], sector: "Consumer Health" },  // LSE / NYSE
  { ticker: "EL", names: ["Essilor", "EssilorLuxottica"], sector: "Med Devices" },  // Euronext Paris
  { ticker: "NESN", names: ["Nestlé", "Nestle", "Société des Produits Nestlé"], sector: "Consumer" },  // SIX
  { ticker: "OR", names: ["L'Oreal", "L'Oréal"], sector: "Consumer" },  // Euronext Paris
  { ticker: "MOVE", names: ["Medacta"], sector: "Med Devices" },  // SIX
  { ticker: "XVIVO", names: ["XVIVO Perfusion"], sector: "Med Devices" },  // Stockholm
  { ticker: "BIOG", names: ["BioGaia"], sector: "Consumer Health" },  // Stockholm
  { ticker: "BINV", names: ["BioInvent"], sector: "Pharma" },  // Stockholm
  { ticker: "NAMS", names: ["NewAmsterdam Pharma"], sector: "Pharma" },  // Nasdaq
  { ticker: "MLTX", names: ["MoonLake"], sector: "Pharma" },  // Nasdaq
  { ticker: "QURE", names: ["UniQure", "uniQure"], sector: "Pharma" },  // Nasdaq
  { ticker: "ACIU", names: ["AC Immune"], sector: "Pharma" },  // Nasdaq
  { ticker: "CRSP", names: ["CRISPR Therapeutics"], sector: "Pharma" },  // Nasdaq
  { ticker: "CNTA", names: ["Centessa"], sector: "Pharma" },  // Nasdaq
  { ticker: "BCYC", names: ["BicycleTx", "Bicycle Therapeutics"], sector: "Pharma" },  // Nasdaq
  { ticker: "PHIL", names: ["Philogen"], sector: "Pharma" },  // Milan CHECK
  { ticker: "RAD", names: ["Radiopharm Theranostics"], sector: "Pharma" },  // ASX
  { ticker: "PYC", names: ["PYC Therapeutics"], sector: "Pharma" },  // ASX
  { ticker: "COH", names: ["Cochlear"], sector: "Med Devices" },  // ASX
  { ticker: "FPH", names: ["Fisher and Paykel Healthcare", "Fisher & Paykel Healthcare"], sector: "Med Devices" },  // NZX / ASX
  { ticker: "6446", names: ["PharmaEssentia"], sector: "Pharma" },  // Taipei Exchange
  { ticker: "4743", names: ["Oneness Biotech"], sector: "Pharma" },  // Taipei Exchange CHECK
  { ticker: "6919", names: ["Caliway"], sector: "Pharma" },  // Taipei Exchange CHECK
  { ticker: "HTFL", names: ["HeartFlow"], sector: "Healthcare IT" },  // Nasdaq (IPO 2025)
  { ticker: "VNDA", names: ["Vanda Pharmaceuticals"], sector: "Pharma" },
  { ticker: "AGIO", names: ["Agios"], sector: "Pharma" },
  { ticker: "ARWR", names: ["Arrowhead"], sector: "Pharma" },
  { ticker: "MIRM", names: ["Mirum"], sector: "Pharma" },
  { ticker: "TGTX", names: ["TG Therapeutics"], sector: "Pharma" },
  { ticker: "IDYA", names: ["IDEAYA"], sector: "Pharma" },
  { ticker: "RCKT", names: ["Rocket Pharmaceuticals"], sector: "Pharma" },
  { ticker: "CGON", names: ["Cullinan"], sector: "Pharma" },
  { ticker: "VSTM", names: ["Verastem"], sector: "Pharma" },
  { ticker: "FDMT", names: ["4D Molecular"], sector: "Pharma" },
  { ticker: "IBRX", names: ["ImmunityBio"], sector: "Pharma" },
  { ticker: "DRTS", names: ["Alpha Tau"], sector: "Med Devices" },
  { ticker: "BHVN", names: ["Biohaven"], sector: "Pharma" },
  { ticker: "REPL", names: ["Replimune"], sector: "Pharma" },
  { ticker: "RCUS", names: ["Arcus Biosciences"], sector: "Pharma" },
  { ticker: "XNCR", names: ["Xencor"], sector: "Pharma" },
  { ticker: "KPTI", names: ["Karyopharm"], sector: "Pharma" },
  { ticker: "PRAX", names: ["Praxis Precision"], sector: "Pharma" },
  { ticker: "FOLD", names: ["Amicus"], sector: "Pharma" },
  { ticker: "CLDX", names: ["Celldex"], sector: "Pharma" },
  { ticker: "EBS", names: ["Emergent BioSolutions"], sector: "Pharma" },
  { ticker: "LXEO", names: ["Lexeo"], sector: "Pharma" },
  { ticker: "RGNX", names: ["REGENXBIO"], sector: "Pharma" },
  { ticker: "CRNX", names: ["Crinetics"], sector: "Pharma" },
  { ticker: "VIR", names: ["Vir Biotechnology"], sector: "Pharma" },
  { ticker: "TVTX", names: ["Travere"], sector: "Pharma" },
  { ticker: "FATE", names: ["Fate Therapeutics"], sector: "Pharma" },
  { ticker: "NTLA", names: ["Intellia"], sector: "Pharma" },
  { ticker: "KURA", names: ["Kura Oncology"], sector: "Pharma" },
  { ticker: "NRIX", names: ["Nurix"], sector: "Pharma" },
  { ticker: "PCRX", names: ["Pacira"], sector: "Pharma" },
  { ticker: "ADVM", names: ["Adverum"], sector: "Pharma" },
  { ticker: "AURA", names: ["Aura Biosciences"], sector: "Pharma" },
  { ticker: "BEAM", names: ["Beam Therapeutics"], sector: "Pharma" },
  { ticker: "CDNA", names: ["CareDx"], sector: "Diagnostics" },
  { ticker: "COGT", names: ["Cogent Biosciences"], sector: "Pharma" },
  { ticker: "LQDA", names: ["Liquidia"], sector: "Pharma" },
  { ticker: "OCGN", names: ["Ocugen"], sector: "Pharma" },
  { ticker: "ZBIO", names: ["Zenas BioPharma"], sector: "Pharma" },
  { ticker: "EWTX", names: ["Edgewise"], sector: "Pharma" },
  { ticker: "RNA", names: ["Avidity Biosciences"], sector: "Pharma" },  // Novartis acquisition announced Oct 2025, status to confirm CHECK
  { ticker: "ALLO", names: ["Allogene"], sector: "Pharma" },
  { ticker: "MGNX", names: ["MacroGenics"], sector: "Pharma" },
  { ticker: "SYRE", names: ["Spyre"], sector: "Pharma" },
  { ticker: "CABA", names: ["Cabaletta"], sector: "Pharma" },
  { ticker: "CHRS", names: ["Coherus"], sector: "Pharma" },
  { ticker: "ORKA", names: ["Oruka"], sector: "Pharma" },
  { ticker: "TCRX", names: ["TScan"], sector: "Pharma" },
  { ticker: "ATXS", names: ["Astria"], sector: "Pharma" },
  { ticker: "RNAC", names: ["Cartesian"], sector: "Pharma" },
  { ticker: "IMNM", names: ["Immunome"], sector: "Pharma" },
  { ticker: "KYMR", names: ["Kymera"], sector: "Pharma" },
  { ticker: "OLMA", names: ["Olema"], sector: "Pharma" },
  { ticker: "SNDX", names: ["Syndax"], sector: "Pharma" },
  { ticker: "ACET", names: ["Adicet"], sector: "Pharma" },
  { ticker: "ALXO", names: ["ALX Oncology"], sector: "Pharma" },
  { ticker: "AVBP", names: ["ArriVent"], sector: "Pharma" },
  { ticker: "CADL", names: ["Candel"], sector: "Pharma" },
  { ticker: "CLRB", names: ["Cellectar"], sector: "Pharma" },
  { ticker: "JANX", names: ["Janux"], sector: "Pharma" },
  { ticker: "PGEN", names: ["Precigen"], sector: "Pharma" },
  { ticker: "PLSE", names: ["Pulse Biosciences"], sector: "Med Devices" },
  { ticker: "RIGL", names: ["Rigel"], sector: "Pharma" },
  { ticker: "SLDB", names: ["Solid Biosciences"], sector: "Pharma" },
  { ticker: "IRD", names: ["Opus Genetics"], sector: "Pharma" },
  { ticker: "VRDN", names: ["Viridian"], sector: "Pharma" },
  { ticker: "PTGX", names: ["Protagonist"], sector: "Pharma" },
  { ticker: "CL", names: ["Colgate Palmolive", "Colgate"], sector: "Consumer" },
  { ticker: "PEP", names: ["PepsiCo"], sector: "Consumer" },
  { ticker: "ALGN", names: ["Align"], sector: "Dental" },
  { ticker: "GERN", names: ["Geron"], sector: "Pharma" },
  { ticker: "DAWN", names: ["Day One"], sector: "Pharma" },
  { ticker: "DNTH", names: ["Dianthus"], sector: "Pharma" },
  { ticker: "TARS", names: ["Tarsus"], sector: "Pharma" },
  { ticker: "VERA", names: ["Vera Therapeutics"], sector: "Pharma" },
  { ticker: "ANAB", names: ["AnaptysBio"], sector: "Pharma" },
  { ticker: "ARQT", names: ["Arcutis"], sector: "Pharma" },
  { ticker: "APGE", names: ["Apogee"], sector: "Pharma" },
  { ticker: "KROS", names: ["Keros"], sector: "Pharma" },
  { ticker: "MRUS", names: ["Merus"], sector: "Pharma" },
  { ticker: "MNMD", names: ["MindMed"], sector: "Pharma" },
  { ticker: "CMPS", names: ["Compass Pathways"], sector: "Pharma" },
  { ticker: "UPB", names: ["Upstream Bio"], sector: "Pharma" },
  { ticker: "CRBU", names: ["Caribou"], sector: "Pharma" },
  { ticker: "ABUS", names: ["Arbutus"], sector: "Pharma" },
  { ticker: "TNGX", names: ["Tango Therapeutics"], sector: "Pharma" },
  { ticker: "PEPG", names: ["PepGen"], sector: "Pharma" },
  { ticker: "WVE", names: ["Wave Life Sciences"], sector: "Pharma" },
  { ticker: "STOK", names: ["Stoke Therapeutics"], sector: "Pharma" },
  { ticker: "PRTA", names: ["Prothena"], sector: "Pharma" },
  { ticker: "ABCL", names: ["AbCellera"], sector: "Pharma" },
  { ticker: "RLAY", names: ["Relay Therapeutics"], sector: "Pharma" },
  { ticker: "REVB", names: ["Revelation"], sector: "Pharma" },
  { ticker: "ERAS", names: ["Erasca"], sector: "Pharma" },
  { ticker: "INBX", names: ["Inhibrx"], sector: "Pharma" },
  { ticker: "MLYS", names: ["Mineralys"], sector: "Pharma" },
  { ticker: "ACLX", names: ["Arcellx"], sector: "Pharma" },
  { ticker: "GPCR", names: ["Structure Therapeutics"], sector: "Pharma" },
  { ticker: "AKRO", names: ["Akero"], sector: "Pharma" },  // acquired by Novo Nordisk announced Oct 2025 CHECK
  { ticker: "SRRK", names: ["Scholar Rock"], sector: "Pharma" },
  { ticker: "ENTA", names: ["Enanta"], sector: "Pharma" },
  { ticker: "ESPR", names: ["Esperion"], sector: "Pharma" },
  { ticker: "RYTM", names: ["Rhythm"], sector: "Pharma" },
  { ticker: "SVRA", names: ["Savara"], sector: "Pharma" },
  { ticker: "TRDA", names: ["Entrada"], sector: "Pharma" },
  { ticker: "MRSN", names: ["Mersana"], sector: "Pharma" },
  { ticker: "SLNO", names: ["Soleno"], sector: "Pharma" },
  { ticker: "LRMR", names: ["Larimar"], sector: "Pharma" },
  { ticker: "HSIC", names: ["Henry Schein"], sector: "Dental" },
  { ticker: "ZIMV", names: ["ZimVie"], sector: "Med Devices" },
  { ticker: "SRDX", names: ["Surmodics"], sector: "Med Devices" },
  { ticker: "IRMD", names: ["IRADIMED"], sector: "Med Devices" },
  { ticker: "TCMD", names: ["Tactile"], sector: "Med Devices" },
  { ticker: "INMD", names: ["InMode"], sector: "Med Devices" },
  { ticker: "PRGO", names: ["Perrigo"], sector: "Pharma" },
  { ticker: "CYRX", names: ["Cryoport"], sector: "Services" },
  { ticker: "PRIVATE", names: ["Qilu Pharmaceutical", "W.L.Gore", "Gore & Associates", "Institut Pasteur", "Aesculap", "B. Braun", "Addpharma", "Biocad", "InSightec", "Jemincare", "iOMEDICO", "Radicle Science", "Hamad Medical", "Truway Health", "Miltenyi", "Power Life Sciences", "Chongqing Precision Biotech", "Grit Biotechnology", "Efforia", "Genoss", "ChinaNorm", "Vigonvita", "Aspargo", "Viome", "RAI Services", "PT. Prodia", "Ceric", "Exactech", "Rhaeos", "Laboratoires Thea", "Perspectum", "Withings", "Target PharmaSolutions", "Biotronik", "Inmunotek", "Occlutech", "Brainfarma", "ADARx", "HC Biopharma", "BTL Industries", "Ivoclar", "Clinical Nutrition Research Center", "Aktiia", "Applied Biology", "BioSensics", "Gene Solutions", "GeneCradle", "Hudson Biotech", "iVascular", "NovelMed", "Pharmazz", "R-Pharm", "TORL", "Xeltis", "LEO Pharma", "Eurofarma", "Debiopharm", "GT Metabolic", "Efferon", "Eko Devices", "Geneplus", "Rise Therapeutics", "Shape Memory", "USWM", "Acandis", "Bioray", "Bolton Medical", "BrosMed", "Getz Pharma", "Kind Pharmaceuticals", "Kumquat", "Vascutek", "Wandercraft", "Qualia", "Alfasigma", "Eikon Therapeutics", "GI Windows", "Septodont", "Kailera", "MMI (Medical Microinstruments", "Polares Medical", "Serum Institute of India", "Societe dEtude", "SystImmune", "Urotronic", "AlloSource", "Atridia", "FH ORTHO", "HistoSonics", "Inception Fertility", "Molnlycke", "AgNovos", "Anabio", "Asklepios", "Aziende Chimiche Riunite Angelini", "Bambusa", "Biosensors Europe", "Candela", "Concept Medical", "CoreAalst", "Frontera Therapeutics", "Genetix", "HJN Sverige", "iCell Gene", "Impulse Dynamics", "iSTAR Medical", "Kriya", "Luminary", "M.A. Med Alliance", "Neuralink", "NS Pharma", "Ponce Medical School", "PT Bio Farma", "Sofwave", "Laboratorios Sophia", "Lacer", "Amazentis", "Rousselot", "Cook Research", "Meril Life", "Italfarmaco", "LucasBio", "Materia Medica", "Olistic", "SuperPatch", "ZIWIG", "Bioceramed", "CatalYm", "Corsano", "Idoven", "Kaneka Medical", "LUMA Vision", "Nimble Science", "Synergy Spine", "Tiger Biosciences", "Volta Medical", "A.M.I. Agency", "A2 Biotherapeutics", "Adenocyte", "AOP Orphan", "Applied Biologics", "Beacon Therapeutics", "Biocells", "BioSyngen", "Caranx", "Cellenkos", "CEN Biotech", "Cerenome", "Collagen Matrix", "Corin", "Generate Biomedicines", "Genomic Prediction", "Hemab", "HighLife", "IBSA", "Kardium", "Minovia", "Novlead", "Olly, PBC", "Oystershell", "Pharmacosmos", "Restore Biologics", "Richmond Research", "Salvia BioElectronics", "Singlera", "SpyGlass Pharma", "US Oncology Research", "VelaVigo", "Pierre Fabre", "Dompé", "Merz", "Endologix", "Advanced Medical Solutions", "Koite Health", "i+Med", "Sclnow", "Aurigene", "MED-EL", "Revance", "Cutera", "Sword Health", "Stemline Therapeutics", "Merz Pharmaceuticals"], sector: "Private" },
  { ticker: "8436", names: ["TCI Co"], sector: "Consumer Health" },  // TCI (Taiwan) CHECK
  { ticker: "DEMANT", names: ["Oticon"], sector: "Med Devices" },  // Demant (Copenhagen)
  { ticker: "BN", names: ["Nutricia"], sector: "Consumer" },  // Danone (Euronext Paris)
  { ticker: "EMBLA", names: ["Össur", "Embla Medical"], sector: "Med Devices" },  // Össur renamed Embla Medical, Nasdaq Copenhagen CHECK
  { ticker: "4516", names: ["Nippon Shinyaku"], sector: "Pharma" },  // TSE
  { ticker: "TLX", names: ["Telix"], sector: "Pharma" },  // ASX / Nasdaq
  { ticker: "SUPN", names: ["Sage Therapeutics"], sector: "Pharma" },  // acquired by Supernus 2025
  { ticker: "JAZZ", names: ["Chimerix"], sector: "Pharma" },  // acquired by Jazz 2025
  { ticker: "HLUN", names: ["Longboard"], sector: "Pharma" },  // acquired by Lundbeck 2024
  { ticker: "SNY", names: ["Vigil Neuroscience"], sector: "Pharma" },  // acquired by Sanofi 2025
  { ticker: "SYK", names: ["Inari"], sector: "Med Devices" },  // acquired by Stryker 2025
  { ticker: "1877", names: ["Shanghai Junshi", "Junshi Biosciences"], sector: "Pharma" },  // Junshi (HKEX / SSE STAR 688180)
  { ticker: "1093", names: ["Shanghai JMT-Bio"], sector: "Pharma" },  // CSPC subsidiary CHECK
  { ticker: "1177", names: ["LaNova Medicines"], sector: "Pharma" },  // Sino Biopharm acquisition 2025 CHECK
  { ticker: "AORT", names: ["JOTEC"], sector: "Med Devices" },  // Artivion subsidiary
  { ticker: "PRIVATE", names: ["MediLink Therapeutics", "Minghui Pharmaceutical", "Valenta Pharm", "SightGlass Vision", "RDC Clinical", "Shanghai Juncell", "Chengdu Zenitar", "PersonGen", "Shandong New Time", "InventisBio", "Guangzhou Lupeng", "Jiangsu vcare", "Evopoint", "Shanghai Minwei"], sector: "Private" },
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
// lowercase and strip accents so "Nestlé" matches "Nestle" and word boundaries behave
function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

const COMPILED_MAP = TICKER_MAP.map(function (entry) {
  return { entry: entry, patterns: entry.names.map(function (n) { return new RegExp("\\b" + escRe(norm(n)) + "\\b"); }) };
});

// names: [{ name, role }] already filtered to INDUSTRY class. Returns the first matching entry.
function matchNames(names) {
  for (var n = 0; n < names.length; n++) {
    var lower = norm(names[n].name);
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
