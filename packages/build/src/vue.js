import { getExternalsFromDependencies } from './webpack'
import { merge } from '@ditojs/utils'

export function getVueConfig(config) {
  return merge({
    css: {
      extract: false,
      loaderOptions: {
        sass: {
          additionalData: `@import './src/styles/_imports'`,
          sassOptions: {
            includePaths: ['./src/styles']
          }
        }
      }
    },

    configureWebpack: {
      externals: process.env.NODE_ENV === 'production'
        ? getExternalsFromDependencies()
        : {}
    },

    chainWebpack: config => {
      // When in watch mode, configure webpack a bit differently:
      if (process.argv.includes('--watch')) {
        // - Disable 'compact' option in babel-loader:
        config.module.rule('js')
          .use('babel-loader')
          .options({ compact: false })
        // - Disable eslint, as it somehow complains about compressed imports:
        config.module.rules.delete('eslint')
        // - Disable progress plugin, which floods the console since
        //   @vue/cli-service 3.11.0
        //   https://github.com/vuejs/vue-cli/issues/3603
        config.plugins.delete('progress')
      }
    }
  }, config)
}
