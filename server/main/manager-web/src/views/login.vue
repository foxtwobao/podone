<template>
  <div class="welcome">
    <el-container style="height: 100%">
      <el-header>
        <div style="
            display: flex;
            align-items: center;
            margin-top: 11px;
            margin-left: 11px;
            gap: 10px;
          ">
          <img loading="lazy" alt="" src="@/assets/xiaozhi-logo.png" style="width: 42px; height: 42px" />
          <img loading="lazy" alt="" :src="xiaozhiAiIcon" style="height: 20px" />
        </div>
      </el-header>
      <div class="login-person">
        <img loading="lazy" alt="" src="@/assets/login/login-person.png" style="width: 100%" />
      </div>
      <el-main style="position: relative">
        <div class="login-box">
          <div style="
              display: flex;
              align-items: center;
              gap: 20px;
              margin-bottom: 39px;
              padding: 0 30px;
            ">
            <img loading="lazy" alt="" src="@/assets/login/hi.png" style="width: 34px; height: 34px" />
            <div class="login-text">{{ $t("login.title") }}</div>

            <div class="login-welcome">
              {{ $t("login.welcome") }}
            </div>

            <!-- 语言切换下拉菜单 -->
            <el-dropdown trigger="click" class="title-language-dropdown"
              @visible-change="handleLanguageDropdownVisibleChange">
              <span class="el-dropdown-link">
                <span class="current-language-text">{{ currentLanguageText }}</span>
                <i class="el-icon-arrow-down el-icon--right" :class="{ 'rotate-down': languageDropdownVisible }"></i>
              </span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item @click.native="changeLanguage('zh_CN')">
                  {{ $t("language.zhCN") }}
                </el-dropdown-item>
                <el-dropdown-item @click.native="changeLanguage('zh_TW')">
                  {{ $t("language.zhTW") }}
                </el-dropdown-item>
                <el-dropdown-item @click.native="changeLanguage('en')">
                  {{ $t("language.en") }}
                </el-dropdown-item>
                <el-dropdown-item @click.native="changeLanguage('de')">
                  {{ $t("language.de") }}
                </el-dropdown-item>
                <el-dropdown-item @click.native="changeLanguage('vi')">
                  {{ $t("language.vi") }}
                </el-dropdown-item>
                <el-dropdown-item @click.native="changeLanguage('pt_BR')">
                  {{ $t("language.ptBR") }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
          </div>
          <div class="idone-login">
            <p>使用 IDONE 账号登录，管理你的设备和智能体。</p>
            <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
            <el-button type="primary" :loading="loading" :disabled="!ready" @click="login">
              使用 IDONE 登录
            </el-button>
            <p v-if="!loading && !ready">登录服务尚未配置，请联系管理员。</p>
          </div>
          <div style="font-size: 14px; color: #979db1">
            {{ $t("login.agreeTo") }}
            <div style="display: inline-block; color: #5778ff; cursor: pointer" @click="openPage('/user-agreement.html')">
              {{ $t("login.userAgreement") }}
            </div>
            {{ $t("login.and") }}
            <div style="display: inline-block; color: #5778ff; cursor: pointer" @click="openPage('/privacy-policy.html')">
              {{ $t("login.privacyPolicy") }}
            </div>
          </div>
        </div>
      </el-main>
      <el-footer>
        <version-footer />
      </el-footer>
    </el-container>
  </div>
</template>

<script>
import Api from "@/apis/api";
import VersionFooter from "@/components/VersionFooter.vue";
import i18n, { changeLanguage } from "@/i18n";
import { authUrl } from "@/apis/auth";
import { saveLoginRedirect } from "@/utils/loginRedirect";

export default {
  name: "login",
  components: {
    VersionFooter,
  },
  computed: {
    // 获取当前语言
    currentLanguage() {
      return i18n.locale || "zh_CN";
    },
    // 获取当前语言显示文本
    currentLanguageText() {
      const currentLang = this.currentLanguage;
      switch (currentLang) {
        case "zh_CN":
          return this.$t("language.zhCN");
        case "zh_TW":
          return this.$t("language.zhTW");
        case "en":
          return this.$t("language.en");
        case "de":
          return this.$t("language.de");
        case "vi":
          return this.$t("language.vi");
        case "pt_BR":
          return this.$t("language.ptBR");
        default:
          return this.$t("language.zhCN");
      }
    },
    // 根据当前语言获取对应的xiaozhi-ai图标
    xiaozhiAiIcon() {
      const currentLang = this.currentLanguage;
      switch (currentLang) {
        case "zh_CN":
          return require("@/assets/xiaozhi-ai.png");
        case "zh_TW":
          return require("@/assets/xiaozhi-ai_zh_TW.png");
        case "en":
          return require("@/assets/xiaozhi-ai_en.png");
        case "de":
          return require("@/assets/xiaozhi-ai_de.png");
        case "vi":
          return require("@/assets/xiaozhi-ai_vi.png");
        default:
          return require("@/assets/xiaozhi-ai.png");
      }
    },
  },
  data() {
    return { ready: false, loading: true, error: '', languageDropdownVisible: false };
  },
  mounted() {
    if (this.$route.query.authError) this.error = 'IDONE 登录未完成，请重新登录；如仍失败，请联系管理员。';
    Api.user.getPubConfig(({ data }) => {
      this.ready = data.data.idoneEnabled === true;
      this.loading = false;
    }, () => {
      this.error = '无法读取登录配置，请刷新页面重试。';
      this.loading = false;
    });
  },
  methods: {
    openPage(url) {
      const lang = this.$i18n ? this.$i18n.locale : 'zh_CN';
      if (!lang.startsWith('zh')) {
        url = url.replace('.html', '-en.html');
      }
      window.open(url, '_blank');
    },
    // 切换语言下拉菜单的可见状态变化
    handleLanguageDropdownVisibleChange(visible) {
      this.languageDropdownVisible = visible;
    },

    // 切换语言
    changeLanguage(lang) {
      changeLanguage(lang);
      this.languageDropdownVisible = false;
      this.$message.success({
        message: this.$t("message.success"),
        showClose: true,
      });
    },

    login() {
      if (!this.ready || this.loading) return;
      try {
        this.loading = true;
        saveLoginRedirect(this.$route.query.redirect);
        window.location.assign(authUrl('idone/login'));
      } catch (error) {
        this.error = error.message;
        this.loading = false;
      }
    }
  },
};
</script>
<style lang="scss" scoped>
@import "./auth.scss";

.idone-login {
  padding: 0 30px 24px;
  p { color: #818cae; font-size: 14px; line-height: 1.6; }
  .el-button { width: 100%; margin-top: 20px; }
}

.title-language-dropdown {
  margin-left: auto;
}

.current-language-text {
  margin-left: 4px;
  margin-right: 4px;
  font-size: 12px;
  color: #3d4566;
}

.language-dropdown {
  margin-left: auto;
}

.rotate-down {
  transform: rotate(180deg);
  transition: transform 0.3s ease;
}

.el-icon-arrow-down {
  transition: transform 0.3s ease;
}

:deep(.el-button--primary) {
  background-color: #5778ff;
  border-color: #5778ff;

  &:hover,
  &:focus {
    background-color: #4a6ae8;
    border-color: #4a6ae8;
  }

  &:active {
    background-color: #3d5cd6;
    border-color: #3d5cd6;
  }
}
</style>
