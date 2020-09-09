import aws from 'aws-sdk'
import multerS3 from 'multer-s3'
import { Storage } from './Storage'
import { toPromiseCallback } from '@ditojs/utils'

export class S3Storage extends Storage {
  static type = 's3'

  constructor(app, config) {
    super(app, config)
    const {
      name,
      s3,
      acl,
      bucket,
      contentType,
      ...options
    } = config
    this.s3 = new aws.S3(s3)
    this.acl = acl
    this.bucket = bucket

    this.storage = multerS3({
      s3: this.s3,
      acl,
      bucket,
      contentType: contentType || multerS3.AUTO_CONTENT_TYPE,
      ...options,

      key: (req, file, cb) => {
        cb(null, this.getUniqueFilename(file.originalname))
      },

      metadata: (req, file, cb) => {
        // Store the determined width and height as meta-data on the s3 object
        // as well. You never know, it may become useful :)
        const { width, height } = file
        if (width != null || height != null) {
          cb(null, {
            width: `${width}`,
            height: `${height}`
          })
        } else {
          cb(null, {})
        }
      }
    })
  }

  // @override
  _getFileName(file) {
    return file.key
  }

  // @override
  _getStorageProperties(name, file) {
    return {
      url: this._getFileUrl(name, file.location)
    }
  }

  // @override
  _extractStorageProperties(file) {
    return {
      url: file.url
    }
  }

  // @override
  async _addFile(file, buffer) {
    const data = await this.execute('upload', {
      Bucket: this.bucket,
      ACL: this.acl,
      Key: file.name,
      Body: buffer
    })
    return data
  }

  // @override
  async _removeFile(file) {
    await this.execute('deleteObject', {
      Bucket: this.bucket,
      Key: file.name
    })
    // TODO: Check for errors and throw?
  }

  // @override
  _areFilesEqual(_file1, _file2) {
    return _file1.url === _file2.url
  }

  _getFileUrl(name, location) {
    // Attempt `getUrl()` first to allow S3 buckets to define their own
    // base URLs, e.g. for CloudFront, fall back to default S3 location:
    return this._getUrl(name) || location
  }

  execute(method, params) {
    return new Promise((resolve, reject) => {
      this.s3[method](params, toPromiseCallback(resolve, reject))
    })
  }
}
