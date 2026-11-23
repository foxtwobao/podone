<route lang="jsonc" type="page">
{
  "layout": "default",
  "style": {
    "navigationStyle": "custom",
    "navigationBarTitleText": "Login"
  }
}
</route>

<script lang="ts" setup>
import type { Language } from '@/store/lang'
import { onLoad } from '@dcloudio/uni-app'
import { onMounted, ref } from 'vue'
import { exchangeIdoneToken, startIdoneLogin } from '@/api/auth'
import { changeLanguage, getCurrentLanguage, getSupportedLanguages, initI18n, t } from '@/i18n'
import { useConfigStore, useUserStore } from '@/store'

const safeAreaInsets = uni.getSystemInfoSync().safeAreaInsets
const configStore = useConfigStore()
const userStore = useUserStore()
const loading = ref(false)
const ready = ref(false)
const error = ref('')
const showLanguageSheet = ref(false)
const supportedLanguages = getSupportedLanguages()
initI18n()

function handleLanguageChange(lang: Language) {
  changeLanguage(lang)
  showLanguageSheet.value = false
}

function goToUserAgreement() {
  uni.navigateTo({ url: `/pages/login/user-agreement-${getCurrentLanguage() === 'zh_CN' ? 'zh' : 'en'}` })
}

function goToPrivacyPolicy() {
  uni.navigateTo({ url: `/pages/login/privacy-policy-${getCurrentLanguage() === 'zh_CN' ? 'zh' : 'en'}` })
}

function handleLogin() {
  if (!ready.value || loading.value) return
  try {
    loading.value = true
    startIdoneLogin()
  }
  catch (cause) {
    error.value = (cause as Error).message
    loading.value = false
  }
}

onLoad(async (options) => {
  if (options?.authError) error.value = 'IDONE 登录未完成，请重新登录。'
  if (options?.authComplete !== '1') return
  loading.value = true
  userStore.removeUserInfo()
  // #ifdef H5
  // 领取凭据前清除完成标记，刷新页面不会重复交换。
  window.history.replaceState(null, '', `${window.location.pathname}#/pages/login/index`)
  // #endif
  try {
    const token = await exchangeIdoneToken()
    uni.setStorageSync('xiaozhi-mobile-token', JSON.stringify(token))
    await userStore.getUserInfo()
    uni.reLaunch({ url: '/pages/index/index' })
  }
  catch (cause) {
    userStore.removeUserInfo()
    error.value = (cause as Error).message || '登录失败，请重新登录'
  }
  finally {
    loading.value = false
  }
})

onMounted(async () => {
  try {
    const config = await configStore.fetchPublicConfig()
    ready.value = config.idoneEnabled === true
  }
  catch {
    error.value = '无法读取登录配置，请刷新页面重试。'
  }
})
</script>

<template>
  <view class="app-container box-border h-screen w-full" :style="{ paddingTop: `${safeAreaInsets?.top}px` }">
    <view class="header">
      <view class="logo-section">
        <wd-img :width="80" :height="80" round src="/static/logo.png" class="logo" />
        <text class="welcome-text">
          {{ t('login.welcomeBack') }}
        </text>
        <text class="subtitle">
          {{ t('login.pleaseLogin') }}
        </text>
      </view>
    </view>

    <!-- 右上角按钮组 -->
    <view class="top-right-buttons" :style="{ top: `${safeAreaInsets?.top + 10}px` }">
      <!-- 语言切换按钮 -->
      <view class="lang-btn" @click="showLanguageSheet = true">
        <text class="lang-text-icon">
          {{ t('login.selectLanguageTip') }}
        </text>
      </view>


    </view>

    <view class="form-container">
      <view class="form">
        <text class="idone-description">使用 IDONE 账号登录，管理你的设备和智能体。</text>
        <text v-if="error" class="idone-error">{{ error }}</text>
        <wd-button block :loading="loading" :disabled="!ready" @click="handleLogin">使用 IDONE 登录</wd-button>
        <text v-if="!ready" class="idone-description">登录服务尚未配置，请联系管理员。</text>
        <view class="policy-links">
          <text class="policy-link" @click="goToUserAgreement">
            {{ t('login.userAgreement') }}
          </text>
          <text class="policy-divider">
            {{ '|' }}
          </text>
          <text class="policy-link" @click="goToPrivacyPolicy">
            {{ t('login.privacyPolicy') }}
          </text>
        </view>

      </view>
    </view>

    <!-- 语言选择弹窗 -->
    <wd-action-sheet
      v-model="showLanguageSheet"
      :title="t('login.selectLanguage')"
      :close-on-click-modal="true"
    >
      <view class="language-sheet">
        <scroll-view scroll-y class="language-list">
          <view
            v-for="lang in supportedLanguages"
            :key="lang.code"
            class="language-item"
            @click="handleLanguageChange(lang.code)"
          >
            <text class="language-name">
              {{ lang.name }}
            </text>
          </view>
        </scroll-view>
      </view>
    </wd-action-sheet>
  </view>
</template>

<style lang="scss" scoped>
.idone-description { display: block; margin: 24rpx 0; color: #818cae; font-size: 28rpx; line-height: 1.6; }
.idone-error { display: block; margin-bottom: 24rpx; color: #c63535; font-size: 28rpx; }

.app-container {
  background: linear-gradient(145deg, #f5f8fd, #6baaff, #9ebbfc, #f5f8fd);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  min-height: 100vh;

  &::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
    animation: float 6s ease-in-out infinite;
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0px) rotate(0deg);
  }
  50% {
    transform: translateY(-20px) rotate(180deg);
  }
}

.header {
  flex: 0 0 auto;
  min-height: 280rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 15% 0 40rpx 0;

  .logo-section {
    text-align: center;

    .logo {
      margin-bottom: 20rpx;
      box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.1);
    }

    .welcome-text {
      display: block;
      color: #ffffff;
      font-size: 40rpx;
      font-weight: 600;
      margin-bottom: 12rpx;
      text-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.1);
    }

    .subtitle {
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 26rpx;
      font-weight: 400;
    }
  }
}

.form-container {
  padding: 0 40rpx 40rpx 40rpx;
  flex: 1;
  display: flex;
  align-items: flex-start;

  .form {
    width: 100%;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 24rpx;
    padding: 40rpx 30rpx 30rpx 30rpx;
    backdrop-filter: blur(10rpx);
    box-shadow: 0 20rpx 60rpx rgba(0, 0, 0, 0.1);
    border: 1rpx solid rgba(255, 255, 255, 0.2);
    max-height: calc(100vh - 350rpx);
    overflow-y: auto;

    .input-group {
      margin-bottom: 24rpx;

      .input-wrapper {
        position: relative;
        border-radius: 16rpx;
        padding: 20rpx 16rpx;
        border: 2rpx solid #e9ecef;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;

        &:focus-within {
          border-color: #667eea;
          background: #ffffff;
          box-shadow: 0 0 0 6rpx rgba(102, 126, 234, 0.1);
        }

        &.captcha-wrapper {
          .captcha-image {
            margin-left: 20rpx;
            width: 150rpx;
            height: 60rpx;
            border-radius: 8rpx;
            overflow: hidden;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #e9ecef;
            border: 1rpx solid #ddd;

            .captcha-img {
              width: 100%;
              height: 100%;
            }

            .captcha-loading {
              font-size: 20rpx;
              color: #999;
            }
          }
        }

        &.mobile-wrapper {
          padding: 0;
          background: transparent;
          border: none;
          display: flex;
          gap: 20rpx;

          .area-code-selector {
            flex: 0 0 160rpx;
            background: #f8f9fa;
            border-radius: 16rpx;
            padding: 20rpx 16rpx;
            border: 2rpx solid #e9ecef;
            height: 45rpx;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            transition: all 0.3s ease;

            &:hover {
              border-color: #667eea;
              background: #ffffff;
              box-shadow: 0 0 0 6rpx rgba(102, 126, 234, 0.1);
            }

            .area-code-text {
              font-size: 28rpx;
              color: #333333;
              font-weight: 500;
            }

            :deep(.area-code-arrow) {
              font-size: 24rpx;
              color: #999999;
              transition: transform 0.3s ease;
            }
          }

          .mobile-input-wrapper {
            flex: 1;
            background: #f8f9fa;
            border-radius: 16rpx;
            padding: 20rpx 16rpx;
            border: 2rpx solid #e9ecef;
            transition: all 0.3s ease;

            &:focus-within {
              border-color: #667eea;
              background: #ffffff;
              box-shadow: 0 0 0 6rpx rgba(102, 126, 234, 0.1);
            }
          }
        }

        :deep(.styled-input) {
          background: transparent !important;
          border: none !important;
          outline: none !important;
          font-size: 32rpx;
          color: #333333;
          flex: 1;

          &::placeholder {
            color: #999999;
            font-size: 28rpx;
          }
        }
      }
    }

    .hint-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30rpx;
    }

    .policy-links {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 20rpx;
      margin-bottom: 30rpx;

      .policy-link {
        color: #667eea;
        font-size: 26rpx;
        cursor: pointer;

        &:hover {
          text-decoration: underline;
        }
      }

      .policy-divider {
        color: #999999;
        font-size: 26rpx;
      }
    }

    .forgot-password {
      .forgot-text {
        color: #667eea;
        font-size: 26rpx;
        cursor: pointer;

        &:hover {
          text-decoration: underline;
        }
      }
    }

    .login-btn {
      width: 100%;
      height: 80rpx;
      border: none;
      border-radius: 16rpx;
      font-size: 30rpx;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 30rpx;
      box-shadow: 0 8rpx 24rpx rgba(102, 126, 234, 0.3);
      transition: all 0.3s ease;
      background-color: var(--wot-button-primary-bg-color, var(--wot-color-theme, #4d80f0));
      text-align: center;
      line-height: 80rpx;
      &:active {
        transform: translateY(2rpx);
        box-shadow: 0 4rpx 12rpx rgba(102, 126, 234, 0.3);
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .register-hint {
      .register-link {
        color: #667eea;
        font-size: 26rpx;
        font-weight: 500;
        cursor: pointer;
        // text-decoration: underline;
        // &:hover {
        //   text-decoration: underline;
        // }
      }
    }

    .login-type-switch {
      margin-top: 20rpx;
      text-align: center;

      .switch-tabs {
        display: flex;
        justify-content: center;
        gap: 60rpx;
        margin-bottom: 20rpx;

        .switch-tab {
          width: 60rpx;
          height: 60rpx;
          border-radius: 50%;
          background: #f0f0f0;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          border: 2rpx solid transparent;

          &.active {
            background: #667eea;
            color: #ffffff;
            border-color: #667eea;
            box-shadow: 0 4rpx 12rpx rgba(102, 126, 234, 0.3);
          }

          :deep(.wd-icon) {
            font-size: 24rpx;
          }
        }
      }

      .switch-hint {
        font-size: 24rpx;
        color: #666666;
      }
    }
  }
}

// 区号选择弹窗样式
.area-code-sheet {
  background: #ffffff;
  border-radius: 24rpx 24rpx 0 0;
  overflow: hidden;

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 40rpx 40rpx 20rpx 40rpx;
    border-bottom: 1rpx solid #f0f0f0;

    .sheet-title {
      font-size: 36rpx;
      font-weight: 600;
      color: #333333;
    }

    :deep(.close-icon) {
      font-size: 32rpx;
      color: #999999;
      cursor: pointer;
      padding: 10rpx;

      &:hover {
        color: #333333;
      }
    }
  }

  .area-code-list {
    max-height: 60vh;
    padding: 0 40rpx;

    .area-code-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 32rpx 0;
      border-bottom: 1rpx solid #f8f9fa;
      cursor: pointer;
      transition: background-color 0.3s ease;

      &:hover {
        background-color: #f8f9fa;
      }

      &.selected {
        background-color: rgba(102, 126, 234, 0.05);

        .area-name {
          color: #667eea;
          font-weight: 500;
        }

        .area-code {
          color: #667eea;
        }
      }

      .area-info {
        display: flex;
        flex-direction: column;
        gap: 8rpx;

        .area-name {
          font-size: 32rpx;
          color: #333333;
        }

        .area-code {
          font-size: 28rpx;
          color: #666666;
        }
      }

      :deep(.check-icon) {
        font-size: 32rpx;
        color: #667eea;
      }
    }
  }

  .sheet-footer {
    padding: 30rpx 40rpx 40rpx 40rpx;
    border-top: 1rpx solid #f0f0f0;

    :deep(.confirm-btn) {
      width: 100%;
      height: 88rpx;
      border-radius: 16rpx;
      font-size: 32rpx;
      font-weight: 600;
    }
  }
}
// 右上角按钮组
.top-right-buttons {
  position: absolute;
  right: 20rpx;
  display: flex;
  gap: 20rpx;
  z-index: 999;
}

// 语言切换按钮
.lang-btn {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 24rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.2);

  &:active {
    transform: scale(0.95);
  }

  .lang-text-icon {
    font-size: 18rpx;
    color: #ffffff;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }
}

// 服务端设置按钮
.server-btn {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 24rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.2);

  &:active {
    transform: scale(0.95);
  }

  .server-icon {
    font-size: 28rpx;
    color: #ffffff;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }
}

// 语言选择弹窗样式
.language-sheet {
  background: #ffffff;
  border-radius: 24rpx 24rpx 0 0;
  overflow: hidden;

  .language-list {
    max-height: 60vh;
    padding: 0 40rpx;

    .language-item {
      display: flex;
      align-items: center;
      padding: 32rpx 0;
      border-bottom: 1rpx solid #f8f9fa;
      cursor: pointer;
      transition: background-color 0.3s ease;

      &:hover {
        background-color: #f8f9fa;
      }

      &:last-child {
        border-bottom: none;
      }

      .language-name {
        font-size: 32rpx;
        color: #333333;
      }
    }
  }
}
</style>
