var crypt = require("./listener/crypt");

var KMSHelper = function(AWS, region, keyId) {

    var kms = new AWS.KMS({region: region});

    this.encrypt = function(params, callback) {
        kmsParams = {
            KeyId: keyId,
            KeySpec: 'AES_256'
        }
        kms.generateDataKey(kmsParams, function(err, kmsData) {
          if (err) {
            callback(err, null);
          } else {
            var helper = new crypt.Helper(kmsData.Plaintext.toString('base64'), {
                    algorithm: params.CipherAlgorithm, 
                    decryptedEncoding: params.DecryptedEncoding
                });
            callback(null, {
                data: helper.encrypt(params.data),
                key: kmsData.CiphertextBlob.toString('base64'),
                cipherAlgorithm: params.CipherAlgorithm,
                decryptedEncoding: params.DecryptedEncoding
            });
          }
        });
    }

    this.decrypt = function (params, callback) {
        var kmsKeyBuffer = new Buffer(params.key, 'base64');
        kms.decrypt({CiphertextBlob: kmsKeyBuffer}, function(err, kmsData) {
          if (err) {
            callback(err, null);
          } else {
            var helper = new crypt.Helper(kmsData.Plaintext.toString('base64'), {
                    algorithm: params.CipherAlgorithm, 
                    decryptedEncoding: params.DecryptedEncoding
                });
            callback(null, helper.decrypt(params.data.toString('utf-8')));
          }
        });
    }

};

module.exports = KMSHelper;