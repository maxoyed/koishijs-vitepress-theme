import { DefaultTheme, UserConfig } from 'vitepress'
import { mergeConfig } from 'vite'
import { resolve } from 'path'
import { htmlEscape, slugify } from '@mdit-vue/shared'
import { Dict, isNullable, pick, valueMap } from 'cosmokit'
import yaml from '@maikolib/vite-plugin-yaml'
import search from './search'
import crowdin from './crowdin'
import container from './markdown/container'
import highlight from './markdown/highlight'
import fence from './markdown/fence'

const locales = {
  'de-DE': require('../locales/de-DE'),
  'en-US': require('../locales/en-US'),
  'fr-FR': require('../locales/fr-FR'),
  'ja-JP': require('../locales/ja-JP'),
  'ru-RU': require('../locales/ru-RU'),
  'zh-CN': require('../locales/zh-CN'),
}

export interface ThemeConfig extends Omit<DefaultTheme.Config, 'socialLinks' | 'algolia'> {
  indexName?: string
  socialLinks?: Record<string, string>
  docsearch?: Partial<DefaultTheme.AlgoliaSearchOptions>
  crowdin?: Dict
}

export namespace ThemeConfig {
  export interface SocialLink {
    icon: string
    link: string
  }
}

interface Config extends UserConfig<ThemeConfig> {
  fallbackLocale?: string
  locales?: Dict
  mixins?: Dict<Config>
}

const getRepoName = (title: string) => {
  if (title.startsWith('@')) {
    return title.slice(1)
  } else {
    return 'koishijs/' + title
  }
}

const getIndexName = (title: string) => {
  if (title.startsWith('@koishijs/')) {
    return title.slice(10)
  } else if (title.startsWith('koishi-plugin-')) {
    return title.slice(14)
  }
}

function merge(a: any, b: any) {
  if (isNullable(a)) return b
  if (isNullable(b)) {
    return a
  } else if (typeof b !== 'object') {
    return b
  }
  const result = {}
  for (const key in { ...a, ...b }) {
    result[key] = merge(a[key], b[key])
  }
  return result
}

export const git = (() => {
  const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || 'main'
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || ''
  return { branch, sha }
})()

function transformLocale(prefix: string, source: any, oldPrefix: string) {
  if (typeof source !== 'object') {
    return source
  } else if (Array.isArray(source)) {
    return source.map(item => transformLocale(prefix, item, oldPrefix))
  }

  const result: any = {}
  for (const key in source) {
    const value = source[key]
    if (typeof value === 'string') {
      if (key === 'link') {
        result[key] = value.startsWith('/') ? oldPrefix + prefix + value.slice(oldPrefix.length) : value
      } else if (key === 'activeMatch') {
        result[key] = '^' + oldPrefix + prefix + value.slice(oldPrefix.length)
      } else {
        result[key] = value
      }
    } else if (key === 'sidebar') {
      if (Array.isArray(value)) {
        result[key] = {
          [oldPrefix + prefix + '/']: transformLocale(prefix, value, oldPrefix),
        }
      } else {
        result[key] = {}
        for (const prop in value) {
          result[key][oldPrefix + prefix + prop.slice(oldPrefix.length)] = transformLocale(prefix, value[prop], oldPrefix)
        }
      }
    } else {
      result[key] = transformLocale(prefix, value, oldPrefix)
    }
  }
  return result
}

export const defineConfig = async (config: Config): Promise<Config> => ({
  ...config,

  locales: config.locales && valueMap(config.locales, (value, locale) => {
    let result = locales[locale]
    if (config.mixins) {
      for (const prefix in config.mixins) {
        if (!config.mixins[prefix].locales[locale]) continue
        result = merge(result, transformLocale(prefix, config.mixins[prefix].locales[locale], `/${locale}`))
      }
    }
    result = merge(result, transformLocale(`/${locale}`, value, ''))
    return result
  }),

  themeConfig: {
    outline: [2, 3],
    ...locales[config.fallbackLocale || 'zh-CN'],
    ...config.themeConfig,

    mixins: config.mixins && valueMap(config.mixins, value => pick(value, ['title'])),

    socialLinks: Object.entries({
      github: `https://github.com/${getRepoName(config.title)}`,
      ...config.themeConfig.socialLinks,
    }).map(([icon, link]) => ({ icon, link })),

    crowdin: process.env.CROWDIN_TOKEN
      ? await crowdin(+process.env.CROWDIN_PROJECT, +process.env.CROWDIN_BRANCH)
      : null,
  },

  transformPageData(pageData, ctx) {
    const locale = (() => {
      for (const locale in config.locales) {
        if (pageData.filePath.startsWith(locale + '/')) return locale
      }
    })()
    for (const prefix in config.mixins) {
      const mixin = config.mixins[prefix]
      Object.assign(mixin, mixin.locales[locale])
      if (pageData.filePath.startsWith(locale + prefix)) {
        pageData.titleTemplate ||= mixin.titleTemplate || mixin.title
        pageData.description ||= mixin.description
      }
    }
  },

  markdown: {
    highlight: await highlight('one-dark-pro'),
    ...config?.markdown,
    anchor: {
      slugify: str => slugify(str
        .replace(/\(.+\)(?=\s|$)/, '')
        .replace(/ *<badge.+/, '')),
      ...config?.markdown?.anchor,
    },
    config(md) {
      md.use(fence)
      md.use(container, {
        type: 'tabs',
        before: info => `<tab-select class="${info}">`,
        after: () => '</tab-select>',
      })
      md.use(container, {
        type: 'tab',
        before(info) {
          const name = info.split(/\s+/, 1)[0]
          const title = info.slice(name.length).trim()
          let result = `<template #tab-${name}>`
          if (title) {
            result = `<template #title-${name}>${htmlEscape(title)}</template>` + result
          }
          return result
        },
        after: () => '</template>',
      })
      config?.markdown?.config?.(md)
    },
  },

  vite: mergeConfig({
    resolve: {
      dedupe: ['vue'],
      alias: {
        '@theme-default': 'vitepress/dist/client/theme-default',
        './VPNavBarTitle.vue': resolve(__dirname, '../client/components/navbar-title.vue'),
        '../composables/edit-link': resolve(__dirname, '../client/composables/edit-link'),
        '../composables/outline': resolve(__dirname, '../client/composables/outline'),
      },
    },

    optimizeDeps: {
      include: ['vue'],
    },

    server: {
      fs: {
        strict: false,
      },
    },

    plugins: [
      yaml(),
      ...process.env.MEILISEARCH_HOST ? [search({
        host: process.env.MEILISEARCH_HOST,
        readKey: process.env.MEILISEARCH_READ_KEY,
        writeKey: process.env.MEILISEARCH_WRITE_KEY,
        indexName: config.themeConfig.indexName ?? getIndexName(config.title),
      })] : [],
    ],
  }, config?.vite || {}),
})
