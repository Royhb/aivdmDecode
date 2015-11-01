var _       = require('underscore');
var colors  = require('colors');
var sprintf = require('sprintf-js').sprintf;

/**
 * used to decode AIS messages.
 * Currently decodes types 1,2,3,4,5,9,18,19,21,24,27
 * Currently does not decode 6,7,8,10,11,12,13,14,15,16,17,20,22,23,25,26
 * Currently does not support the USCG Extended AIVDM messages
 *
 * Normal usage:
 *      var decoder = new aivdmDecode.aivdmDecode(options)
 *          then
 *      decoder.decode(aivdm);
 *      var msgData = decoder.getData();
 *
 *      aisData will return with an object that contains the message fields.
 *      The object returned will also include the sentence(s) that were decoded.  This is to make it easy to
 *      use the decoder to filter based on in-message criteria but then forward the undecoded packets.
 *
 *      The decoded data object uses field naming conventions in the same way that GPSD does.
 *
 * @param {object} options:
 *      returnJson:         If true then json is returned instead of a javascript object (default false)
 *      aivdmPassthrough    If true then the aivdm messages that were decoded are included with the returned object
 *                          default false
 */

/**
 * String.lpad:  Used to pad mmsi's to 9 digits and imo's to 7 digits
 * Converts number to string, then lpads it with padString to length
 * @param {string} padString The character to use when padding
 * @param desiredLength   The desired length after padding
 */
Number.prototype.lpad = function (padString, desiredLength) {
    var str = '' + this;
    while (str.length < desiredLength)
        str = padString + str;
    return str;
};

var aivdmDecode = function (options) {
    if (options) {
        // returnJson:  If true, returns json instead of an object
        this.returnJson = options.returnJson || false;
        // aivdmPassthrough: If true then the original aivdm sentences are embedded in the returned object
        this.aivdmPassthrough = options.aivdmPassthrough || true;
        // includeMID:  If true then the mid (nationality) of the vessels is included in the returned object
        this.includeMID = options.includeMID || true;
        // accept_related.  Passed as true to decoder when you wish static packets with accepted MMSI passed to output
        //this.accept_related = options.accept_related || true;
        // isDebug.  If true, prints debug messages
        this.isDebug = options.isDebug || false;
    } else {
        this.returnJson = false;
        this.aivdmPassthrough = true;
        this.includeMID = true;
        this.isDebug = false;
    }

    this.AIVDM = '';
    this.splitParts = [];   // Contains aivdm's of multi part messages
    this.splitPart1Sequence = null;
    this.splitPart1Type = null;
    this.splitLines = [];   // contains untrimmed lines of multi part messages
    this.numFragments = null;
    this.fragmentNum = null;
    this.seqMsgId = '';
    this.binString = '';
    this.partNo = null;
    this.channel = null;
    this.msgType = null;
    this.supportedTypes = [1,2,3,4,5,9,18,19,21,24,27];
    this.char_table = [
        /*
         4th line would normally be:
         '[', '\\', ']', '^', '_', ' ', '!', '"', '#', '$', '%', '&', '\\', '(', ')', '*', '+', ',', '-','.', '/',
         but has been customized to eliminate most punctuation characters
         Last line would normally be:
         ':', ';', '<', '=', '>', '?'
         but has been customized to eliminate most punctuation characters
         */
        '@', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
        'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '-', '-', '-', '-', '_', ' ', '-', '-', '-', '-', '-', '-',
        '-', '(', ')', '-', '-', '-', '-', '.', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '-', '<',
        '-', '>', '-'
    ];
    this.posGroups = {
        1: {'lat': {'start': 89, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 61, 'length': 28, 'divisor': 600000.0}},
        2: {'lat': {'start': 89, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 61, 'length': 28, 'divisor': 600000.0}},
        3: {'lat': {'start': 89, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 61, 'length': 28, 'divisor': 600000.0}},
        4: {'lat': {'start': 107, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 79, 'length': 28, 'divisor': 600000.0}},
        9: {'lat': {'start': 89, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 61, 'length': 28, 'divisor': 600000.0}},
        18: {'lat': {'start': 85, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 57, 'length': 28, 'divisor': 600000.0}},
        19: {'lat': {'start': 85, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 57, 'length': 28, 'divisor': 600000.0}},
        21: {'lat': {'start': 192, 'length': 27, 'divisor': 600000.0},
            'lon': {'start': 164, 'length': 28, 'divisor': 600000.0}},
        27: {'lat': {'start': 62, 'length': 17, 'divisor': 600.0},
            'lon': {'start': 44, 'length': 18, 'divisor': 600.0}}
    };
    this.speedGroups = {
        1: {'start': 50, 'length': 10, 'divisor': 10},
        2: {'start': 50, 'length': 10, 'divisor': 10},
        3: {'start': 50, 'length': 10, 'divisor': 10},
        9: {'start': 50, 'length': 10, 'divisor': 1},
        18: {'start': 46, 'length': 10, 'divisor': 10},
        19: {'start': 46, 'length': 10, 'divisor': 10},
        27: {'start': 79, 'length': 6, 'divisor': 1}
    };
    this.navStatusText = [
        'Under way using engine',
        'At anchor',
        'Not under command',
        'Restricted manoeuverability',
        'Constrained by her draught',
        'Moored',
        'Aground',
        'Engaged in Fishing',
        'Under way sailing',
        'Reserved for future amendment of Navigational Status for HSC',
        'Reserved for future amendment of Navigational Status for WIG',
        'Reserved for future use',
        'Reserved for future use',
        'Reserved for future use',
        'AIS-SART is active',
        'Not defined'
    ];
    this.maneuverText = [
        'Not available',
        'No special maneuver',
        'Special maneuver (such as regional passing arrangement'
    ];
    this.epfdText = [
        'Undefined',
        'GPS',
        'GLONASS',
        'Combined GPS/GLONASS',
        'Loran-C',
        'Chayka',
        'Integrated navigation system',
        'Surveyed',
        'Galileo'
    ];
    this.shiptypeText = [
        "Not available",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Reserved for future use",
        "Wing in ground (WIG) - all ships of this type",
        "Wing in ground (WIG) - Hazardous category A",
        "Wing in ground (WIG) - Hazardous category B",
        "Wing in ground (WIG) - Hazardous category C",
        "Wing in ground (WIG) - Hazardous category D",
        "Wing in ground (WIG) - Reserved for future use",
        "Wing in ground (WIG) - Reserved for future use",
        "Wing in ground (WIG) - Reserved for future use",
        "Wing in ground (WIG) - Reserved for future use",
        "Wing in ground (WIG) - Reserved for future use",
        "Fishing",
        "Towing",
        "Towing: length exceeds 200m or breadth exceeds 25m",
        "Dredging or underwater ops",
        "Diving ops",
        "Military ops",
        "Sailing",
        "Pleasure Craft",
        "Reserved",
        "Reserved",
        "High speed craft (HSC) - all ships of this type",
        "High speed craft (HSC) - Hazardous category A",
        "High speed craft (HSC) - Hazardous category B",
        "High speed craft (HSC) - Hazardous category C",
        "High speed craft (HSC) - Hazardous category D",
        "High speed craft (HSC) - Reserved for future use",
        "High speed craft (HSC) - Reserved for future use",
        "High speed craft (HSC) - Reserved for future use",
        "High speed craft (HSC) - Reserved for future use",
        "High speed craft (HSC) - No additional information",
        "Pilot Vessel1",
        "Search and Rescue vessel",
        "Tug",
        "Port Tender",
        "Anti-pollution equipment",
        "Law Enforcement",
        "Spare - Local Vessel",
        "Spare - Local Vessel",
        "Medical Transport",
        "Ship according to RR Resolution No. 18",
        "Passenger - all ships of this type",
        "Passenger - Hazardous category A",
        "Passenger - Hazardous category B",
        "Passenger - Hazardous category C",
        "Passenger - Hazardous category D",
        "Passenger - Reserved for future use",
        "Passenger - Reserved for future use",
        "Passenger - Reserved for future use",
        "Passenger - Reserved for future use",
        "Passenger - No additional information",
        "Cargo - all ships of this type",
        "Cargo - Hazardous category A",
        "Cargo - Hazardous category B",
        "Cargo - Hazardous category C",
        "Cargo - Hazardous category D",
        "Cargo - Reserved for future use",
        "Cargo - Reserved for future use",
        "Cargo - Reserved for future use",
        "Cargo - Reserved for future use",
        "Cargo - No additional information",
        "Tanker - all ships of this type",
        "Tanker - Hazardous category A",
        "Tanker - Hazardous category B1",
        "Tanker - Hazardous category C1",
        "Tanker - Hazardous category D1",
        "Tanker - Reserved for future use",
        "Tanker - Reserved for future use",
        "Tanker - Reserved for future use",
        "Tanker - Reserved for future use",
        "Tanker - No additional information",
        "Other Type - all ships of this type",
        "Other Type - Hazardous category A",
        "Other Type - Hazardous category B",
        "Other Type - Hazardous category C",
        "Other Type - Hazardous category D",
        "Other Type - Reserved for future use",
        "Other Type - Reserved for future use",
        "Other Type - Reserved for future use",
        "Other Type - Reserved for future use",
        "Other Type - no additional information"
    ];
    this.midTable = {
        202: "Andorra (Principality of)",
        203: "Austria",
        204: "Azores - Portugal",
        205: "Belgium",
        206: "Belarus (Republic of)",
        207: "Bulgaria (Republic of)",
        208: "Vatican City State",
        209: "Cyprus (Republic of)",
        210: "Cyprus (Republic of)",
        211: "Germany (Federal Republic of)",
        212: "Cyprus (Republic of)",
        213: "Georgia",
        214: "Moldova (Republic of)",
        215: "Malta",
        216: "Armenia (Republic of)",
        218: "Germany (Federal Republic of)",
        219: "Denmark",
        220: "Denmark",
        224: "Spain",
        225: "Spain",
        226: "France",
        227: "France",
        228: "France",
        229: "Malta",
        230: "Finland",
        231: "Faroe Islands - Denmark",
        232: "United Kingdom of Great Britain and Northern Ireland",
        233: "United Kingdom of Great Britain and Northern Ireland",
        234: "United Kingdom of Great Britain and Northern Ireland",
        235: "United Kingdom of Great Britain and Northern Ireland",
        236: "Gibraltar - United Kingdom of Great Britain and Northern Ireland",
        237: "Greece",
        238: "Croatia (Republic of)",
        239: "Greece",
        240: "Greece",
        241: "Greece",
        242: "Morocco (Kingdom of)",
        243: "Hungary",
        244: "Netherlands (Kingdom of the)",
        245: "Netherlands (Kingdom of the)",
        246: "Netherlands (Kingdom of the)",
        247: "Italy",
        248: "Malta",
        249: "Malta",
        250: "Ireland",
        251: "Iceland",
        252: "Liechtenstein (Principality of)",
        253: "Luxembourg",
        254: "Monaco (Principality of)",
        255: "Madeira - Portugal",
        256: "Malta",
        257: "Norway",
        258: "Norway",
        259: "Norway",
        261: "Poland (Republic of)",
        262: "Montenegro",
        263: "Portugal",
        264: "Romania",
        265: "Sweden",
        266: "Sweden",
        267: "Slovak Republic",
        268: "San Marino (Republic of)",
        269: "Switzerland (Confederation of)",
        270: "Czech Republic",
        271: "Turkey",
        272: "Ukraine",
        273: "Russian Federation",
        274: "The Former Yugoslav Republic of Macedonia",
        275: "Latvia (Republic of)",
        276: "Estonia (Republic of)",
        277: "Lithuania (Republic of)",
        278: "Slovenia (Republic of)",
        279: "Serbia (Republic of)",
        301: "Anguilla - United Kingdom of Great Britain and Northern Ireland",
        303: "Alaska (State of) - United States of America",
        304: "Antigua and Barbuda",
        305: "Antigua and Barbuda",
        306: "Dutch West Indies",
        //306: "Curaçao - Netherlands (Kingdom of the)",
        //306: "Sint Maarten (Dutch part) - Netherlands (Kingdom of the)",
        //306: "Bonaire, Sint Eustatius and Saba - Netherlands (Kingdom of the)",
        307: "Aruba - Netherlands (Kingdom of the)",
        308: "Bahamas (Commonwealth of the)",
        309: "Bahamas (Commonwealth of the)",
        310: "Bermuda - United Kingdom of Great Britain and Northern Ireland",
        311: "Bahamas (Commonwealth of the)",
        312: "Belize",
        314: "Barbados",
        316: "Canada",
        319: "Cayman Islands - United Kingdom of Great Britain and Northern Ireland",
        321: "Costa Rica",
        323: "Cuba",
        325: "Dominica (Commonwealth of)",
        327: "Dominican Republic",
        329: "Guadeloupe (French Department of) - France",
        330: "Grenada",
        331: "Greenland - Denmark",
        332: "Guatemala (Republic of)",
        334: "Honduras (Republic of)",
        336: "Haiti (Republic of)",
        338: "United States of America",
        339: "Jamaica",
        341: "Saint Kitts and Nevis (Federation of)",
        343: "Saint Lucia",
        345: "Mexico",
        347: "Martinique (French Department of) - France",
        348: "Montserrat - United Kingdom of Great Britain and Northern Ireland",
        350: "Nicaragua",
        351: "Panama (Republic of)",
        352: "Panama (Republic of)",
        353: "Panama (Republic of)",
        354: "Panama (Republic of)",
        355: "unassigned",
        356: "unassigned",
        357: "unassigned",
        358: "Puerto Rico - United States of America",
        359: "El Salvador (Republic of)",
        361: "Saint Pierre and Miquelon (Territorial Collectivity of) - France",
        362: "Trinidad and Tobago",
        364: "Turks and Caicos Islands - United Kingdom of Great Britain and Northern Ireland",
        366: "United States of America",
        367: "United States of America",
        368: "United States of America",
        369: "United States of America",
        370: "Panama (Republic of)",
        371: "Panama (Republic of)",
        372: "Panama (Republic of)",
        373: "Panama (Republic of)",
        375: "Saint Vincent and the Grenadines",
        376: "Saint Vincent and the Grenadines",
        377: "Saint Vincent and the Grenadines",
        378: "British Virgin Islands - United Kingdom of Great Britain and Northern Ireland",
        379: "United States Virgin Islands - United States of America",
        401: "Afghanistan",
        403: "Saudi Arabia (Kingdom of)",
        405: "Bangladesh (People's Republic of)",
        408: "Bahrain (Kingdom of)",
        410: "Bhutan (Kingdom of)",
        412: "China (People's Republic of)",
        413: "China (People's Republic of)",
        414: "China (People's Republic of)",
        416: "Taiwan (Province of China) - China (People's Republic of)",
        417: "Sri Lanka (Democratic Socialist Republic of)",
        419: "India (Republic of)",
        422: "Iran (Islamic Republic of)",
        423: "Azerbaijan (Republic of)",
        425: "Iraq (Republic of)",
        428: "Israel (State of)",
        431: "Japan",
        432: "Japan",
        434: "Turkmenistan",
        436: "Kazakhstan (Republic of)",
        437: "Uzbekistan (Republic of)",
        438: "Jordan (Hashemite Kingdom of)",
        440: "Korea (Republic of)",
        441: "Korea (Republic of)",
        443: "State of Palestine (In accordance with Resolution 99 Rev. Guadalajara, 2010)",
        445: "Democratic People's Republic of Korea",
        447: "Kuwait (State of)",
        450: "Lebanon",
        451: "Kyrgyz Republic",
        453: "Macao (Special Administrative Region of China) - China (People's Republic of)",
        455: "Maldives (Republic of)",
        457: "Mongolia",
        459: "Nepal (Federal Democratic Republic of)",
        461: "Oman (Sultanate of)",
        463: "Pakistan (Islamic Republic of)",
        466: "Qatar (State of)",
        468: "Syrian Arab Republic",
        470: "United Arab Emirates",
        472: "Tajikistan (Republic of)",
        473: "Yemen (Republic of)",
        475: "Yemen (Republic of)",
        477: "Hong Kong (Special Administrative Region of China) - China (People's Republic of)",
        478: "Bosnia and Herzegovina",
        501: "Adelie Land - France",
        503: "Australia",
        506: "Myanmar (Union of)",
        508: "Brunei Darussalam",
        510: "Micronesia (Federated States of)",
        511: "Palau (Republic of)",
        512: "New Zealand",
        514: "Cambodia (Kingdom of)",
        515: "Cambodia (Kingdom of)",
        516: "Christmas Island (Indian Ocean) - Australia",
        518: "Cook Islands - New Zealand",
        520: "Fiji (Republic of)",
        523: "Cocos (Keeling) Islands - Australia",
        525: "Indonesia (Republic of)",
        529: "Kiribati (Republic of)",
        531: "Lao People's Democratic Republic",
        533: "Malaysia",
        536: "Northern Mariana Islands (Commonwealth of the) - United States of America",
        538: "Marshall Islands (Republic of the)",
        540: "New Caledonia - France",
        542: "Niue - New Zealand",
        544: "Nauru (Republic of)",
        546: "French Polynesia - France",
        548: "Philippines (Republic of the)",
        553: "Papua New Guinea",
        555: "Pitcairn Island - United Kingdom of Great Britain and Northern Ireland",
        557: "Solomon Islands",
        559: "American Samoa - United States of America",
        561: "Samoa (Independent State of)",
        563: "Singapore (Republic of)",
        564: "Singapore (Republic of)",
        565: "Singapore (Republic of)",
        566: "Singapore (Republic of)",
        567: "Thailand",
        570: "Tonga (Kingdom of)",
        572: "Tuvalu",
        574: "Viet Nam (Socialist Republic of)",
        576: "Vanuatu (Republic of)",
        577: "Vanuatu (Republic of)",
        578: "Wallis and Futuna Islands - France",
        601: "South Africa (Republic of)",
        603: "Angola (Republic of)",
        605: "Algeria (People's Democratic Republic of)",
        607: "Saint Paul and Amsterdam Islands - France",
        608: "Ascension Island - United Kingdom of Great Britain and Northern Ireland",
        609: "Burundi (Republic of)",
        610: "Benin (Republic of)",
        611: "Botswana (Republic of)",
        612: "Central African Republic",
        613: "Cameroon (Republic of)",
        615: "Congo (Republic of the)",
        616: "Comoros (Union of the)",
        617: "Cabo Verde (Republic of)",
        618: "Crozet Archipelago - France",
        619: "Côte d'Ivoire (Republic of)",
        620: "Comoros (Union of the)",
        621: "Djibouti (Republic of)",
        622: "Egypt (Arab Republic of)",
        624: "Ethiopia (Federal Democratic Republic of)",
        625: "Eritrea",
        626: "Gabonese Republic",
        627: "Ghana",
        629: "Gambia (Republic of the)",
        630: "Guinea-Bissau (Republic of)",
        631: "Equatorial Guinea (Republic of)",
        632: "Guinea (Republic of)",
        633: "Burkina Faso",
        634: "Kenya (Republic of)",
        635: "Kerguelen Islands - France",
        636: "Liberia (Republic of)",
        637: "Liberia (Republic of)",
        638: "South Sudan (Republic of)",
        642: "Libya",
        644: "Lesotho (Kingdom of)",
        645: "Mauritius (Republic of)",
        647: "Madagascar (Republic of)",
        649: "Mali (Republic of)",
        650: "Mozambique (Republic of)",
        654: "Mauritania (Islamic Republic of)",
        655: "Malawi",
        656: "Niger (Republic of the)",
        657: "Nigeria (Federal Republic of)",
        659: "Namibia (Republic of)",
        660: "Reunion (French Department of) - France",
        661: "Rwanda (Republic of)",
        662: "Sudan (Republic of the)",
        663: "Senegal (Republic of)",
        664: "Seychelles (Republic of)",
        665: "Saint Helena - United Kingdom of Great Britain and Northern Ireland",
        666: "Somalia (Federal Republic of)",
        667: "Sierra Leone",
        668: "Sao Tome and Principe (Democratic Republic of)",
        669: "Swaziland (Kingdom of)",
        670: "Chad (Republic of)",
        671: "Togolese Republic",
        672: "Tunisia",
        674: "Tanzania (United Republic of)",
        675: "Uganda (Republic of)",
        676: "Democratic Republic of the Congo",
        677: "Tanzania (United Republic of)",
        678: "Zambia (Republic of)",
        679: "Zimbabwe (Republic of)",
        701: "Argentine Republic",
        710: "Brazil (Federative Republic of)",
        720: "Bolivia (Plurinational State of)",
        725: "Chile",
        730: "Colombia (Republic of)",
        735: "Ecuador",
        740: "Falkland Islands (Malvinas) - United Kingdom of Great Britain and Northern Ireland",
        745: "Guiana (French Department of) - France",
        750: "Guyana",
        755: "Paraguay (Republic of)",
        760: "Peru",
        765: "Suriname (Republic of)",
        770: "Uruguay (Eastern Republic of)",
        775: "Venezuela (Bolivarian Republic of)"
};
    this.functionMap = {
        "accuracy":         "getAccuracy",
        "aid_type":         "getAidType",
        "alt":              "getAlt",
        "assigned":         "getAssigned",
        "callsign":         "getCallsign",
        "course":           "getCourse",
        "day":              "getDay",
        "destination":      "getDestination",
        "dimensions":       "getDimensions",
        "draught":          "getDraught",
        "dte":              "getDte",
        "epfd":             "getEpfd",
        "fragmentNum":      "getFragmentNum",
        "heading":          "getHeading",
        "hour":             "getHour",
        "imo":              "getIMO",
        "latLon":           "getLatLon",
        "maneuver":         "getManeuver",
        "mid":              "getMid",
        "mmsi":             "getMMSI",
        "minute":           "getMinute",
        "month":            "getMonth",
        "name":             "getName",
        "nameExtension":    "getNameExtension",
        "numFragments":     "getNumFragments",
        "off_position":     "getOffPosition",
        "part":             "getPartno",
        "radio":            "getRadio",
        "raim":             "getRaim",
        "second":           "getSecond",
        "seqMsgId":         "getSeqMsgId",
        "shiptype":         "getShiptype",
        "speed":            "getSpeed",
        "status":           "getStatus",
        "turn":             "getTurn",
        "type":             "getType",
        "vendorInfo":       "getVendorInfo",
        "virtual_aid":      "getVirtualAid",
        "year":             "getYear"
    };
    /**
     * Type 6 and 8  (Binary addressed message and Binary broadcast message) contain lat/lon in some of their subtypes.
     * These messages are evidently only used in the St Lawrence seaway, the USG PAWSS system and the Port Authority of
     * london and aren't implemented in this code
     *
     * Type 17 is the Differential correction message type and is not implemented in this code
     * Type 22 is a channel management message and is not implemented in this code
     * Type 23 is a Group assignment message and is not implemented in this code
     */
};

/** Loads required attributes from AIVDM message for retrieval by other methods
    [0]=!AIVDM, [1]=Number of fragments, [2]=Fragment num, [3]=Seq msg ID, [4]=channel, [5]=payload,
    Fetch the AIVDM part of the line, from !AIVDM to the end of the line
    Split the line into fragments, delimited by commas
    fetch numFragments, fragmentNum and SeqMsgId (SeqMsgId may be empty)
    convert to a binary 6 bit string

    : param (string) line.  The received message within which we hope an AIVDM statement exists
    :returns True if message is a single packet msg (1,2,3,9,18,27 etc) or part 1 of a multi_part message
    False if !AIVDM not in the line or exception during decode process
*/

aivdmDecode.prototype = {
    /**
     * getData(aivdm)
     * Decodes message, then returns an object containing extracted data
     * If the message is received in two parts (i.e. type 5 and 19) then
     * the return for the first of the messages is null.  When the second part has been received then it
     * is combined with the first and decoded.
     * Whether a single or two part message, the return will contain the original message(s) in an array called 'aivdm'
     */
    getData: function (line) {
        var lineData = {
            numFragments: this.numFragments,
            fragmentNum: this.fragmentNum,
            type: this.getType(),
            mmsi: this.getMMSI(),
            mid: this.getMid(),
            seqMsgId: this.getSeqMsgId(),
            aivdm: this.splitLines
        };

        return this.msgTypeSwitcher(line, lineData);
    },

    /**
     * msgTypeSwitcher
     * Used only by getData
     * Fills fields relevant to the message type
     * @param line      The !AIVD string
     * @param lineData  The partially filled lineData object
     * @returns {*}     lineData object or false (if lineData is not filled
     */
    msgTypeSwitcher: function (line, lineData) {
        switch (this.getType()) {
            // Implemented message types
            case 1:
            case 2:
            case 3:
                lineData = this.fill_1_2_3(line, lineData);
                break;
            case 4:
                lineData = this.fill_4(line, lineData);
                break;
            case 5:
                lineData = this.fill_5(line, lineData);
                break;
            case 9:
                lineData = this.fill_9(line, lineData);
                break;
            case 18:
                lineData = this.fill_18(line, lineData);
                break;
            case 19:
                lineData = this.fill_19(line, lineData);
                break;
            case 21:
                lineData = this.fill_21(line, lineData);
                break;
            case 24:
                lineData.partno = this.getPartno();
                if (lineData.partno === 'A') {
                    lineData = this.fill_24_0(line, lineData);
                } else if (lineData.partno === 'B') {
                    lineData = this.fill_24_1(line, lineData);
                }
                break;
            case 27:
                lineData = this.fill_27(line, lineData);
                break;

            // unimplemented message types
            case 6:
            case 7:
            case 8:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 16:
            case 17:
            case 20:
            case 22:
            case 23:
            case 25:
            case 26:
                if (module.parent && module.parent.exports.isDebug) {
                //if (swu.hasProp(module, 'parent.exports.isDebug')) {
                    console.log('Message type (switch) %d', parseInt(this.binString.substr(0, 6), 2));
                    console.log(line);
                    console.log('-------------------------------------------------------');
                }
                lineData = false;
                break;
            default:
                if (module.parent && module.parent.exports.isDebug) {
                //if (swu.hasProp(module, 'prent.exports.isDebug')) {
                    console.log('Message type ????? %d ?????', parseInt(this.binString.substr(0, 6), 2));
                }
                lineData = false;
        }

        if (lineData) {
            if (this.returnJson) {
                return JSON.stringify(lineData);
            } else {
                return lineData;
            }
        } else {
            return false;
        }
    },
    fill_1_2_3: function (line, lineData) {
        var latLon = this.getLatLon();
        var status = this.getStatus();
        var maneuver = this.getManeuver();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.status = status.status_num;
        lineData.status_text = status.status_text;
        lineData.turn = this.getTurn();
        lineData.speed = this.getSpeed();
        lineData.accuracy = this.getAccuracy();
        lineData.lon = latLon.lon;
        lineData.lat = latLon.lat;
        lineData.course = this.getCourse();
        lineData.heading = this.getHeading();
        lineData.second = this.getSecond();
        lineData.maneuver = maneuver.maneuver;
        lineData.maneuver_text = maneuver.maneuver_text;
        lineData.raim = this.getRaim();
        lineData.radio = this.getRadio();

        return lineData;
    },
    fill_4: function (line, lineData) {
        var latLon = this.getLatLon();
        var epfd = this.getEpfd();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.year = this.getYear();
        lineData.month = this.getMonth();
        lineData.day = this.getDay();
        lineData.hour = this.getHour();
        lineData.minute = this.getMinute();
        lineData.second = this.getSecond();
        lineData.accuracy = this.getAccuracy();
        lineData.lon = latLon.lon;
        lineData.lat = latLon.lat;
        lineData.epfd = epfd.epfd;
        lineData.epfd_text = epfd.epfd_text;
        lineData.raim = this.getRaim();
        lineData.radio = this.getRadio();

        return lineData;
    },
    fill_5: function (line, lineData) {
        var dimensions = this.getDimensions();
        var epfd = this.getEpfd();
        var shiptype = this.getShiptype();
        var eta = sprintf(
            '%s-%sT%s:%sZ',
            this.getMonth().lpad('0', 2),
            this.getDay().lpad('0', 2),
            this.getHour().lpad('0', 2),
            this.getMinute().lpad('0', 2)
        );

        //if (this.aivdmPassthrough) { lineData.aivdm = this.splitLines; }
        //if (this.aivdmPassthrough) { lineData.aivdm = this.splitParts; }
        lineData.imo = this.getIMO();
        lineData.callsign = this.getCallsign();
        lineData.shipname = this.getName();
        lineData.shiptype = shiptype.shiptype;
        lineData.shiptype_text = shiptype.shiptype_text;
        lineData.to_bow = dimensions.to_bow;
        lineData.to_stern = dimensions.to_stern;
        lineData.to_port = dimensions.to_port;
        lineData.to_starboard = dimensions.to_starboard;
        lineData.epfd = epfd.epfd;
        lineData.eta = eta;
        lineData.epfd_text = epfd.epfd.text;
        lineData.month = this.getMonth();
        lineData.day = this.getDay();
        lineData.hour = this.getHour();
        lineData.minute = this.getMinute();
        lineData.draught = this.getDraught();
        lineData.destination = this.getDestination();
        lineData.dte = this.getDte();

        return lineData;
    },
    fill_9: function (line, lineData) {
        var latLon = this.getLatLon();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.alt = this.getAlt();
        lineData.speed = this.getSpeed();
        lineData.accuracy = this.getAccuracy();
        lineData.lon = latLon.lon;
        lineData.lat = latLon.lat;
        lineData.course = this.getCourse();
        lineData.second = this.getSecond();
        lineData.assigned = this.getAssigned();
        lineData.raim = this.getRaim();
        lineData.radio = this.getRadio();

        return lineData;
    },
    fill_18: function (line, lineData) {
        var latLon = this.getLatLon();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.speed = this.getSpeed();
        lineData.accuracy = this.getAccuracy();
        lineData.lon = latLon.lon;
        lineData.lat = latLon.lat;
        lineData.course = this.getCourse();
        lineData.heading = this.getHeading();
        lineData.second = this.getSecond();
        lineData.raim = this.getRaim();
        lineData.radio = this.getRadio();

        return lineData;
    },
    fill_19: function (line, lineData) {
        var latLon = this.getLatLon();
        var dimensions = this.getDimensions();
        var epfd = this.getEpfd();
        var shiptype = this.getShiptype();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.speed = this.getSpeed();
        lineData.accuracy = this.getAccuracy();
        lineData.lon = latLon.lon;
        lineData.lat = latLon.lat;
        lineData.course = this.getCourse();
        lineData.heading = this.getHeading();
        lineData.second = this.getSecond();
        lineData.shipname = this.getName();
        lineData.shiptype = shiptype.shiptype;
        lineData.shiptype_text = shiptype.shiptype_text;
        lineData.to_bow = dimensions.to_bow;
        lineData.to_stern = dimensions.to_stern;
        lineData.to_port = dimensions.to_port;
        lineData.to_starboard = dimensions.to_starboard;
        lineData.epfd = epfd.epfd;
        lineData.epfd_text = epfd.epfd_text;
        lineData.raim = this.getRaim();

        return lineData;
    },
    fill_21: function (line, lineData) {
        var latLon = this.getLatLon();
        var dimensions = this.getDimensions();
        var epfd = this.getEpfd();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.aid_type = this.getAidType();
        lineData.name = this.getName();
        lineData.accuracy = this.getAccuracy();
        lineData.lon = latLon.lon;
        lineData.lat = latLon.lat;
        lineData.to_bow = dimensions.to_bow;
        lineData.to_stern = dimensions.to_stern;
        lineData.to_port = dimensions.to_port;
        lineData.to_starboard = dimensions.to_starboard;
        lineData.epfd = epfd.epfd;
        lineData.epfd_text = epfd.epfd_text;
        lineData.second = this.getSecond();
        lineData.off_position = this.getOffPosition();
        lineData.raim = this.getRaim();
        lineData.virtual_aid = this.getVirtualAid();
        lineData.assigned = this.getAssigned();
        lineData.name += this.getNameExtension();

        return lineData;
    },
    fill_24_0: function (line, lineData) {
        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.part = this.getPartno();
        lineData.shipname = this.getName();

        return lineData;
    },
    fill_24_1: function (line, lineData) {
        var dimensions;
        var vendorInfo = this.getVendorInfo();
        var shiptype = this.getShiptype();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.part = this.getPartno();
        lineData.shiptype = shiptype.shiptype;
        lineData.shiptype_text = shiptype.shiptype_text;
        lineData.callsign = this.getCallsign();

        if (lineData.mmsi.toString().substr(0, 2) === '98') {   // Then this is an auxiliary craft (see AIVDM Docs)
            lineData.mothership_mmsi = this.getBits(132, 30);
            dimensions = {to_bow: null, to_stern: null, to_port: null, to_starboard: null};
        } else {
            lineData.mothership_mmsi = null;
            dimensions = this.getDimensions();
        }

        lineData.vendorid = vendorInfo.vendorString;
        lineData.model = vendorInfo.model;
        lineData.serial = vendorInfo.serial;
        lineData.to_bow = dimensions.to_bow;
        lineData.to_stern = dimensions.to_stern;
        lineData.to_port = dimensions.to_port;
        lineData.to_starboard = dimensions.to_starboard;

        return lineData;
    },
    fill_27: function (line, lineData) {
        var latLon = this.getLatLon();
        var status = this.getStatus();

        if (this.aivdmPassthrough) { lineData.aivdm = [line]; }
        lineData.accuracy = this.getAccuracy();
        lineData.raim = this.getRaim();
        lineData.status = status.status_num;
        lineData.status_text = status.status_text;
        lineData.lon = latLon.lon;
        lineData.lat = latLon.lat;
        lineData.speed = this.getSpeed();
        lineData.course = this.getCourse();

        return lineData;
    },
    // -------------------------------

    /**
     * getAccuracy()
     * @returns {boolean} false if 0, else true - to synchronise with how gpsd handles it
     */
    getAccuracy: function () {
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
            case 9:
                return this.getBits(60, 1) !== 0;
            case 18:
            case 19:
                return this.getBits(56, 1) !== 0;
            case 21:
                return this.getBits(163, 1) !== 0;
            case 27:
                return this.getBits(38, 1) !== 0;
            default:
                return false;
        }
    },
    getAidType: function () {
        return this.getBits(38,5);
    },
    getAlt: function () {
        return this.getBits(38, 12);
    },
    getAssigned: function () {
        switch (this.msgType) {
            case 9:
                return this.getBits(146, 1);
            case 21:
                return this.getBits(270, 1);
            default:
                return false;
        }
    },
    getCallsign: function () {
        var callsignField;

        switch (this.msgType) {
            case 5:
                callsignField = this.binString.substr(70, 42);
                break;
            case 24:
                if (this.partNo == 1) {
                    callsignField = this.binString.substr(90, 42);
                } else {
                    callsignField = null;
                }
                break;
            default:
                callsignField = null
        }

        if (callsignField) {
            var callsignArray = callsignField.match(/.{1,6}/g);
            var callsign = '';
            var self = this;
            _.each(callsignArray, function (binChar, index) {
                callsign += self.char_table[parseInt(binChar, 2)];
            });
            return callsign.replace(/@/g, '').trim();
        } else {
            return false;
        }
    },
    getCourse: function () {
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
            case 9:
                return this.getBits(116, 12) / 10;
                break;
            case 18:
            case 19:
                return this.getBits(112, 12) / 10;
                break;
            case 27:
                return this.getBits(85, 9);
                break;
            default:
                return false;
        }
    },
    getDay: function () {
        switch (this.msgType) {
            case 4:
                return this.getBits(56, 5);
            case 5:
                return this.getBits(278, 5);
            default:
                return false;
        }
    },
    getDestination: function () {
        var destField = null;

        switch (this.msgType) {
            case 5:
                destField = this.binString.substr(302, 120);
                break;
            default:
                destField = null
        }
        if (destField) {
            var destArray = destField.match(/.{1,6}/g);
            var destination = '';
            var self = this;
            _.each(destArray, function (binChar, index) {
                destination += self.char_table[parseInt(binChar, 2)];
            });
            return destination.replace(/@/g, '').trim();
        } else {
            return false;
        }
    },
    getDimensions: function () {

        var dimensions = {to_bow: null, to_stern: null, to_port: null, to_starboard: null};

        switch (this.msgType) {
            case 5:
                dimensions.to_bow = this.getBits(240, 9);
                dimensions.to_stern = this.getBits(249, 9);
                dimensions.to_port = this.getBits(258, 6);
                dimensions.to_starboard = this.getBits(264, 6);
                break;
            case 19:
                dimensions.to_bow = this.getBits(271, 9);
                dimensions.to_stern = this.getBits(280, 9);
                dimensions.to_port = this.getBits(289, 6);
                dimensions.to_starboard = this.getBits(295, 6);
                break;
            case 21:
                dimensions.to_bow = this.getBits(219, 9);
                dimensions.to_stern = this.getBits(228, 9);
                dimensions.to_port = this.getBits(237, 6);
                dimensions.to_starboard = this.getBits(243, 6);
                break;

            case 24:
                dimensions.to_bow = this.getBits(132, 9);
                dimensions.to_stern = this.getBits(141, 9);
                dimensions.to_port = this.getBits(150, 6);
                dimensions.to_starboard = this.getBits(156, 6);
                break;
        }
        return dimensions;
    },
    getDraught: function () {
        switch (this.msgType) {
            case 5:
                return this.getBits(294, 8) / 10;
            default:
                return 0;
        }
    },
    getDte: function () {
        switch (this.msgType) {
            case 5:
                return this.getBits(423, 1);
            default:
                return 0;
        }
    },
    getETA: function () {

    },
    getEpfd: function () {
        var epfd;
        switch (this.msgType) {
            case 4:
                epfd = this.getBits(134, 4);
                break;
            case 5:
                epfd = this.getBits(270, 4);
                break;
            case 19:
                epfd = this.getBits(310, 4);
                break;
            case 21:
                epfd = this.getBits(249, 4);
                break;
            default:
                epfd = 0;
        }
        if (epfd < 0 || epfd > 8) { epfd = 0; }
        return {epfd: epfd, epfd_text: this.epfdText[epfd]}
    },
    getFragmentNum: function getFragmentNum () {
        return this.fragmentNum;
    },
    getHeading: function () {
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
                return this.getBits(128, 9);
            case 18:
            case 19:
                return this.getBits(124, 9);
            default:
                return false;
        }
    },
    getHour: function () {
        switch (this.msgType) {
            case 4:
                return this.getBits(61, 5);
            case 5:
                return this.getBits(283, 5);
            default:
                return false;
        }
    },
    getIMO: function () {
        switch (this.msgType) {
            case 5:
                return this.getBits(40, 30);
            default:
                return false;
        }
    },
    getLatLon: function () {
        // Does this message contain position info?
        var msgType = this.getType();
        if (msgType in this.posGroups) {
            var latGroup = this.posGroups[msgType]['lat'];
            var lonGroup = this.posGroups[msgType]['lon'];
            // fetch the relevant bits
            var latString = this.binString.substr(latGroup['start'], latGroup['length']);
            var lonString = this.binString.substr(lonGroup['start'], lonGroup['length']);
            // convert them
            var lat = this.toTwosComplement(parseInt(latString, 2), latString.length) / latGroup['divisor'];
            var lon = this.toTwosComplement(parseInt(lonString, 2), lonString.length) / lonGroup['divisor'];

            return {"lat": parseFloat(lat.toFixed(4)), "lon": parseFloat(lon.toFixed(4))};

        } else {  // Not a message type that contains a position
            return {'lat': null, 'lon': null};
        }
    },
    getManeuver: function () {
        var man, maneuver_text;
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
                man = this.getBits(143, 2);
                break;
            default:
                man = 0;
        }

        if (man < 1 || man > 2) { man = 0; }
        maneuver_text = this.maneuverText[man];
        return {maneuver: man, maneuver_text: maneuver_text};
    },
    /**
     * getMid()  Fetched 3 digit MID number that is embedded in MMSI
     * The mid usually occupies chars 0,1 and 2 of the MMSI string
     * For some special cases it may be at another location (see below).
     * Uses this.midTable to look up nationality.
     * Returns "" unless the option 'includeMID' is set true in the aivdmDecode constructor options
     * @returns {string}  mid - a string containing 3 numeric digits.
     */
    getMid: function () {
        // See info in http://catb.org/gpsd/AIVDM.html
        if (this.includeMID) {
            var mid;
            var mmsi = this.getMMSI();
            var nationality;
            if (mmsi !== null && mmsi.length === 9) {
                // Coastal station
                if (mmsi.substr(0, 2) == "00") {
                    mid = mmsi.substr(2, 3);
                }
                // Group of ships (i.e. coast guard is 0369
                else if (mmsi.substr(0, 1) === "0") {
                    mid = mmsi.substr(1, 3);
                }
                // SAR Aircraft
                else if (mmsi.substr(0, 3) === "111") {
                    mid = mmsi.substr(3, 3);
                }
                // Aus craft associated with a parent ship
                else if (mmsi.substr(0, 2) === "98" || mmsi.substr(0, 2) === "99") {
                    mid = mmsi.substr(2, 3);
                }
                // AIS SART
                else if (mmsi.substr(0, 3) === "970") {
                    mid = mmsi.substr(3, 3);
                }
                // MOB device (972) or EPIRB (974).  Neither of these have a MID
                else if (mmsi.substr(0, 3) === "972" || mmsi.substr(0, 3) === "974") {
                    mid = "";
                }
                // Normal ship transponder
                else {
                    mid = mmsi.substr(0, 3);
                }

                if (mid !== "") {
                    nationality = this.midTable[mid];
                    if (nationality !== undefined) {
                        if (typeof(nationality) !== 'string') {
                            nationality = "";
                        }
                    } else {
                        nationality = "";
                    }
                } else {
                    nationality = "";
                }
            } else {
                nationality = "";
            }
        } else {
            nationality = "";
        }
        return nationality;
    },
    getMMSI: function (/* onlyValidMid */) {
        //TODO:  onlyValidMid to be implemented later
        return this.getBits(8, 30);
    },
    getMinute: function () {
        switch (this.msgType) {
            case 4:
                return this.getBits(66, 6);
            case 5:
                return this.getBits(288, 6);
            default:
                return false;
        }
    },
    getMonth: function () {
        switch (this.msgType) {
            case 4:
                return this.getBits(53, 4);
            case 5:
                return this.getBits(274, 4);
            default:
                return false;
        }
    },
    getName: function () {
        var msgType = this.getType();
        var nameField = null;

        switch (msgType) {
            case 5:
                nameField = this.binString.substr(112, 120);
                break;
            case 19:
                nameField = this.binString.substr(143, 120);
                break;
            case 21:
                nameField = this.binString.substr(43, 120);
                break;
            case 24:
                nameField = this.binString.substr(40, 120);
                break;
            default:
                nameField = null
        }

        if (nameField) {
            var nameArray = nameField.match(/.{1,6}/g);
            var name = '';
            var self = this;
            _.each(nameArray, function (binChar, index) {
                name += self.char_table[parseInt(binChar, 2)];
            });
            return name.replace(/@/g, '').trim();
        } else {
            return false;
        }
    },
    getNameExtension: function () {
        switch (this.msgType) {
            case 21:
                if (this.binString.length >= 272) {
                    var nameBits = this.binString.substring(272, this.binString.length -1);
                    var nameArray = nameBits.match(/.{1,6}/g);
                    var name = '';
                    var self = this;
                    _.each(nameArray, function (binChar, index) {
                        name += self.char_table[parseInt(binChar, 2)];
                    });
                    return name.replace(/@/g, '').trim();
                } else {
                    return '';
                }
                break;
            default:
                return false;
        }
    },
    getNumFragments: function getNumFragments () {
        return this.numFragments;
    },
    getOffPosition: function () {
        return this.getBits(259, 1);
    },
    getPartno: function () {
        switch (this.msgType) {
            case 24:
                var partRaw = parseInt(this.getBits(38, 2), 2);
                var partNo = partRaw === 0 ? 'A' : 'B';
                return partNo;
            default:
                return '';
        }
    },
    getRadio: function () {
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
                return this.getBits(149, 19);
            case 9:
            case 18:
                return this.getBits(148, 19);
            default:
                return false;
        }
    },
    getRaim: function () {
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
                return this.getBits(148, 1) !== 0;
            case 9:
            case 18:
                return this.getBits(147, 1) !== 0;
            case 19:
                return this.getBits(305, 1) !== 0;
            case 21:
                return this.getBits(268, 1) !== 0;
            case 27:
                return this.getBits(39, 1) !== 0;
            default:
                return false;
        }
    },
    getSecond: function () {
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
                return this.getBits(137, 6);
            case 9:
                return this.getBits(128, 6);
            case 18:
            case 19:
                return this.getBits(133, 6);
            case 21:
                return this.getBits(253, 6);
            default:
                return false;
        }
    },
    getSeqMsgId: function () {
        return this.seqMsgId;
    },
    getShiptype: function () {
        var sType;
        switch (this.msgType) {
            case 5:
                sType = this.getBits(232, 8);
                break;
            case 19:
                sType = this.getBits(263, 8);
                break;
            case 24:
                sType = this.getBits(40, 8);
                break;
            default:
                sType = 0;
        }
        if (sType < 0 || sType > 99) { sType = 0; }
        return {shiptype: sType, shiptype_text: this.shiptypeText[sType]};
    },
    getSpeed: function () {
        if (this.numFragments == 1) {
            var msgType = this.getType();
            if (msgType in this.speedGroups) {
                var group = this.speedGroups[msgType];
                var speedString = this.binString.substr(group['start'], group['length']);
                return parseInt(speedString, 2) / group['divisor'];
            } else {
                return false;
            }
        } else {
            return false;
        }
    },
    getStatus: function () {
        var statusText = "", statusNum = -1;
        switch (this.msgType) {
            case 1:
            case 2:
            case 3:
                statusNum = this.getBits(38, 4);
                break;
            case 27:
                statusNum = this.getBits(40, 4);
                break;
        }
        if (statusNum >= 0 && statusNum <= 15) {
            statusText = this.navStatusText[statusNum];
        }
        // status_num coerced to string to match gpsdecode / gpsd
        return {status_num: '' + statusNum, status_text: statusText}
    },
    /**
     * getTurn()  Called only for types 1,2 and 3
     * @returns {null}
     */
    getTurn: function () {
        var turn = this.getBits(42, 8);
        switch (true) {
            case turn === 0:
                break;
            case turn > 0 && turn <= 126:
                return '' + (4.733 * Math.sqrt(turn));
            case turn === 127:
                return 'fastright';
            case turn < 0 && turn >= -126:
                return '' + (4.733 * Math.sqrt(turn));
            case turn === -127:
                return 'fastleft';
            case turn == 128 || turn == -128:
                return "nan";
            default:
                return "nan";
        }
    },
    getType: function () {
        return this.getBits(0,6);
    },
    getVendorInfo: function () {
        var vendorBits, vendorArray, vendorString, model, serial;

        switch (this.msgType) {
            case 24:
                vendorBits = this.binString.substr(48, 38);
                vendorArray = vendorBits.match(/.{1,6}/g);
                vendorString = '';
                var self = this;
                _.each(vendorArray, function (binChar, index) {
                    vendorString += self.char_table[parseInt(binChar, 2)];
                });
                vendorString =  vendorString.replace(/@/g, '').trim();
                model = parseInt(this.binString.substr(66, 4), 2);
                serial = parseInt(this.binString.substr(70, 20), 2);

                return {vendorString: vendorString, model: model, serial: serial};
        }
    },
    /**
     * getVendorID not currently implemented
     * @returns {*}
     */
    getVendorID: function () {
        var msgType = this.getType();
        var vendorID = null;

        switch (msgType) {
            case 24:
                vendorID = this.binString.substr(48, 18);
                break;
            default:
                vendorID = null
        }

        if (vendorID) {
            var vendorIDArray = vendorID.match(/.{1,6}/g);
            var vid = '';
            var self = this;
            _.each(vendorIDArray, function (binChar, index) {
                vid += self.char_table[parseInt(binChar, 2)];
            });
            return vid.replace(/@/g, '').trim();
        } else {
            return false;
        }

    },
    getVirtualAid: function () {
        return this.getBits(269, 1);
    },
    getYear: function () {
        switch (this.msgType) {
            case 4:
                return this.getBits(38, 14);
            default:
                return false;
        }
    },
    // ---------------------------------------

    /**
     * manageFragments
     * makes aivdm sentences ready for data fetching by using buildBinString to convert them to a binary string
     * Returns true when a message is ready for data to be fetched.
     * For single part messages this is after processing of the aivdm payload
     * For multi part messages the payloads are accumulated until all have been received, then the binString
     * conversion is done.
     * For multi part messages returns false for the first and any intermediate messages
     * @param line         A string containing an AIVDM or AIVDO sentence.  May have a tag block on the front of the msg
     * @param payload      The payload portion of the AIVD? string
     * @returns {boolean}  true when this.binString has been set, false when this.binString is not set
     */
    manageFragments: function (line, payload) {
        // this.splitParts is an array of payloads that are joined to become the binString of multi msgs
        // this.splitLines is an array of the received lines including AIVDM's
        if (this.numFragments === 1) {
            this.splitLines = [line];
            this.binString = this.buildBinString(payload);
            this.msgType = this.getType();
            return true;
        }

        else if (this.numFragments > 1 && this.fragmentNum === 1) {
            this.splitParts = [payload];
            this.splitLines = [line];
            this.splitPart1Sequence = this.seqMsgId;
            this.binString = this.buildBinString(payload);
            this.splitPart1Type = this.getType();
            this.msgType = this.getType();
            return false;
        }

        else if (this.numFragments > 1 && this.fragmentNum > 1) {
            if (this.seqMsgId === this.splitPart1Sequence) {
                this.splitParts.push(payload);
                this.splitLines.push(line);
            }
        }

        if (this.fragmentNum === this.numFragments) {
            var parts = this.splitParts.join('');
            this.binString = this.buildBinString(parts);
            this.msgType = this.splitPart1Type;
            return true;
        } else {
            return false;
        }
    },
    /**
     * decode
     * @param line          A line containing an !AIVD sentence
     * @returns {boolean}   true if this.binString has been set (ready for data to be fetched
     *                      false if:
     *                          binString not set,
     *                          line is not an !AIVD
     *                          !AIVD is not a supported type (see this.supportedTypes)
     */
    decode: function (bLine) {
        var line = bLine.toString('utf8');

        var aivdmPos = line.indexOf('!AIVD');
        if (aivdmPos !== -1) {
            this.AIVDM = line.substr(aivdmPos);
            var aivdmFragments = this.AIVDM.split(',');
            this.numFragments = parseInt(aivdmFragments[1]);
            this.fragmentNum = parseInt(aivdmFragments[2]);

            try {
                this.seqMsgId = parseInt(aivdmFragments[3]);
                if (typeof(this.seqMsgId) !== 'number') { this.seqMsgId = ''; }
            } catch (err) {
                this.seqMsgId = '';
            }

            this.channel = aivdmFragments[4];
            var payload = aivdmFragments[5];

            if (this.manageFragments(line, payload)) {
                if (_.contains(this.supportedTypes, this.msgType)) {
                    this.msgType = this.getType();
                    if (this.msgType == 24) {
                        this.partNo = this.getBits(38, 2)
                    }
                    return this.getData(bLine);
                    //return true;    // this.binString is ready
                } else {
                    return false;
                }
            } else {            // this.binString is not ready
                return false;
            }
        } else {  // no !AIVD on front of line
            return false;
        }
    },
    buildBinString: function (payload) {
        var binStr = '';
        var payloadArr = payload.split("");

        _.each(payloadArr, function (value) {
            var dec = value.charCodeAt(0);
            var bit8 = dec - 48;
            if (bit8 > 40) {
                bit8 -= 8;
            }
            var strBin = bit8.toString(2);
            strBin = sprintf('%06s', strBin);
            binStr += strBin;
        });
        if (module.parent && module.parent.exports.isDebug) {
        //if (swu.hasProp(module, 'parent.exports.isDebug')) {
            console.log('binString for type ', parseInt(binStr.substr(0, 6), 2), payload, binStr);
        }
        return binStr;
    },
    getBits: function (start, len) {
        return parseInt(this.binString.substr(start, len), 2);
    },
    asciidec_2_8bit: function (dec) {
        var newDec = dec - 48;
        if (newDec > 40) {
            newDec -= 8;
        }
        return newDec;
    },
    dec_2_6bit: function (bit8) {
        var strBin = bit8.toString(2);
        strBin = sprintf('%06s', strBin);
        return strBin;
    },
    toTwosComplement: function (val, bits) {
        if ((val & (1 << (bits - 1))) != 0) {
            val -= 1 << bits;
        }
        return val;
    }
};

module.exports = { aivdmDecode: aivdmDecode };

if (require.main === module) {
    var SW_utilsModule = require('SW_utils');
    SW_utils = new SW_utilsModule.SW_Utils('aivdmDecode', false);
    /**
     * testSet
     * An array of objects.  Each object contains:
     *      aivdm: The raw aivdm sentence to be decoded
     *      gpsd:  aivdm as decoded by gpsdecode
     *      test:  The fields within the decoded aivdm to test
     * @type {*[]}
     */
    var testSet = [
        // type 5 first msg
        {aivdm: '!AIVDM,2,1,4,A,539cRCP00000@7WSON08:3?V222222222222221@4@=3340Ht50000000000,0*13',
         gpsd: ''
        },
        // type 5 second msg
        {aivdm: '!AIVDM,2,2,4,A,00000000000,2*20',
         gpsd: {"class":"AIS","device":"stdin","type":5,"repeat":0,"mmsi":211477070,"scaled":true,"imo":0,"ais_version":0,"callsign":"DA9877 ","shipname":"BB 39","shiptype":80,"shiptype_text":"Tanker - all ships of this type","to_bow":34,"to_stern":13,"to_port":3,"to_starboard":3,"epfd":1,"epfd_text":"GPS","eta":"00-00T24:60Z","draught":2.0,"destination":"","dte":0},
         test: ['type', 'mmsi', 'imo', 'callsign', 'shipname', 'shiptype', 'shiptype_text', 'to_bow', 'to_stern', 'to_port',
                'to_starboard', 'epfd', 'eta', 'draught', 'destination', 'dte']
        },
        // type 1
        {aivdm: '!AIVDM,1,1,,A,144iRPgP001N;PjOb:@F1?vj0PSB,0*47',
         gpsd:  {"class":"AIS","device":"stdin","type":1,"repeat":0,"mmsi":273441410,"scaled":true,"status":"15","status_text":"Not defined","turn":"nan","speed":0.0,"accuracy":false,"lon":20.5739,"lat":55.3277,"course":154.0,"heading":511,"second":25,"maneuver":0,"raim":false,"radio":133330},
         test:  ['type', 'mmsi', 'status', 'status_text','turn', 'speed', 'accuracy', 'lon', 'lat', 'course', 'heading', 'second', 'maneuver', 'raim', 'radio']
        },
        // type 3
        {aivdm: '!AIVDM,1,1,,A,33aTCJ0Oh;8>Q>7kW>eKwaf6010P,0*63',
         gpsd:  {"class":"AIS","device":"stdin","type":3,"repeat":0,"mmsi":244913000,"scaled":true,"status":"0","status_text":"Under way using engine","turn":"fastright","speed":1.1,"accuracy":false,"lon":115.0198,"lat":-21.6479,"course":307.0,"heading":311,"second":3,"maneuver":0,"raim":false,"radio":4128},
         test:  ['type', 'mmsi', 'status', 'status_text', 'turn', 'speed', 'accuracy', 'lon', 'lat', 'course', 'heading', 'second', 'maneuver', 'raim', 'radio']
        },
        // type 9
        {aivdm: "!AIVDM,1,1,,A,97oordNF>hPppq5af003QHi0S7sE,0*52",
         gpsd: {
            "class": "AIS",
            "device": "stdin",
            "type": 9,
            "repeat": 0,
            "mmsi": 528349873,
            "scaled": true,
            "alt": 3672,
            "speed": 944,
            "accuracy": true,
            "lon": 12.4276,
            "lat": -38.9393,
            "course": 90.1,
            "second": 35,
            "regional": 16,
            "dte": 0,
            "raim": false,
            "radio": 818901
         },
         test: ['type', 'mmsi', 'speed', 'lon', 'lat']
        },
        // type 24
        {aivdm: '!AIVDM,1,1,,B,H7OeD@QLE=A<D63:22222222220,2*25',
         gpsd:  {"class":"AIS","device":"stdin","type":24,"repeat":0,"mmsi":503010370,"scaled":true,"part":"A","shipname":"WESTSEA 2"},
         test:  ['type', 'mmsi', 'part', 'shipname']
        },
        //type 24 part A
        {aivdm: '!AIVDM,1,1,,A,H697GjPhT4t@4qUF3;G;?F22220,2*7E',
         gpsd:  {"class":"AIS","device":"stdin","type":24,"repeat":0,"mmsi":412211146,"scaled":true,"part":"A","shipname":"LIAODANYU 25235"},
         test: ['type', 'mmsi', 'part', 'shipname']
        },
        // type 24 part B
        {aivdm: '!AIVDM,1,1,,B,H3mw=<TT@B?>1F0<7kplk01H1120,0*5D',
         gpsd:  {"class":"AIS","device":"stdin","type":24,"repeat":0,"mmsi":257936690,"scaled":true,"part":"B","shiptype":36,"shiptype_text":"Sailing","vendorid":"PRONAV","model":3,"serial":529792,"callsign":"LG3843","to_bow":11,"to_stern":1,"to_port":1,"to_starboard":2},
         test:  ['type', 'mmsi', 'part', 'shiptype', 'shiptype_text', 'vendorid', 'model', 'serial', 'callsign', 'to_bow', 'to_stern', 'to_port', 'to_starboard']
        }
    ];
    var aisDecoder = new aivdmDecode({returnJson: false, aivdmPassthrough: true});

    _.each(testSet, function (val, index) {
        var decoded = aisDecoder.decode(val.aivdm);
        if (decoded) {
            var testSubject = aisDecoder.getData(val.aivdm);
            console.log(colors.cyan('Test subject ' + index));
            if (testSubject && testSubject.type) {
            //if (swu.hasProp(testSubject, 'type')) {
                console.log(colors.cyan('Type: ' + testSubject.type));
            }
            if (val.gpsd.part) {
                console.log(sprintf(colors.cyan('Part %s'), val.gpsd.part));
            }
            if (val.test) {
                _.each(val.test, function (item) {
                    console.log('Testing: ' + item);
                    // test for undefined item in testSubject
                    if (testSubject[item] === undefined) {
                        console.log(colors.red('Item missing ' + item));
                        return;
                    }

                    // test that both items are the same type
                    else if (typeof(val.gpsd[item]) !== typeof(testSubject[item])) {
                        console.log(colors.red('Type mismatch: gpsd: ' + typeof(val.gpsd[item]) + ' me: ' + typeof(testSubject[item])));
                        return;
                    }

                    // if gpsd is int then testSubject should also be int
                    else if (SW_utils.isInt(val.gpsd[item])) {
                        if (!SW_utils.isInt(testSubject[item])) {
                            console.log(colors.red('Type mismatch (gpsd int testsubject float'));
                            return;
                        }

                        // if gpsd is float then testSubject should also be float
                    } else if (SW_utils.isFloat(val.gpsd[item])) {
                        if (!SW_utils.isFloat(testSubject[item])) {
                            console.log(colors.red('Type mismatch (gpsd float testsubject int'));
                            return
                        }
                    }
                    // finally, test items for equality
                    if (typeof(val.gpsd[item]) === 'string') {
                        gItem = val.gpsd[item].trim();
                        tItem = testSubject[item].trim();
                    } else {
                        gItem = val.gpsd[item];
                        tItem = testSubject[item];
                    }
                    if (gItem === tItem) {
                        console.log(
                            sprintf(colors.yellow('Test ok gpsd: %s'), gItem) +
                            sprintf(colors.cyan(' me: %s'), tItem)
                        );
                    } else {
                        console.log(colors.red('Test failed'));
                        console.log(colors.red('gpsd: ' + val.gpsd[item] + ' me: ' + testSubject[item]))
                    }
                })
            }
        }
        if (this.isDebug) { console.log(colors.magenta('----------------------------------------------------------')); }
    });
}
