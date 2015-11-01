# aivdmDecode
AIVDM (AIS) Decoder module for Node,js

to install:
npm install aivdmDecode

To use:

    var aivdmDecode = require('aivdmDecode').aivdmDecode;
    var aisDecoder = new aivdmDecode({returnJson: false, aivdmPassthrough: true});
    var sentences = [
        "!AIVDM,1,1,,B,15DbCb0PAgbmOBsdJb7AJ@ib00SM,0*34",
        "!AIVDM,1,1,,B,37PAfn0Oj3:lIhEd`Ij9gWmd0Pq1,0*2B",
        "!AIVDM,1,1,,A,1;@1hrh00qKbOaGe9UL<dajd04ht,0*74",
        "!AIVDM,2,1,0,B,53ddOr3SnbKSTP7;;?Q9B0@59LTr22222222220l20@57Hm60@T3lU821@A3,0*41",
        "!AIVDM,2,2,0,B,0CQ88888880,2*3D"
    ];
    
    sentences.forEach(function (sentence) {
        var decoded = aisDecoder.decode(sentence);
        console.log(decoded)
    })
    
    Options:
    returnJson:  If true, then the decoded message is returned as JSON, if false, then the decoded message is returned as an object.  Default false 
    aivdmPassthrough: If true then the raw aivdm message is included in the output as property 'aivdm'.  Default true
    includeMID: if true then the nationality of the vessel (derrived from it's mmsi) is returned.  Default true.
    
