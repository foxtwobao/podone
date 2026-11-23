<template>
  <div class="callback">
    <p v-if="!error" role="status">正在完成 IDONE 登录…</p>
    <template v-else>
      <p role="alert">{{ error }}</p>
      <el-button type="primary" @click="$router.replace('/login')">返回登录</el-button>
    </template>
  </div>
</template>

<script>
import { exchangeIdoneToken } from '@/apis/auth';
import Api from '@/apis/api';

export default {
  name: 'IdoneCallback',
  data: () => ({ error: '' }),
  async mounted() {
    this.$store.commit('clearAuth');
    try {
      const token = await exchangeIdoneToken();
      this.$store.commit('setToken', JSON.stringify(token));
      Api.user.getUserInfo(({ data }) => {
        this.$store.commit('setUserInfo', data.data);
        this.$router.replace('/home');
      }, error => {
        this.error = error.data?.msg || '用户信息获取失败，请重新登录';
        this.$store.commit('clearAuth');
      });
    } catch (error) {
      this.error = error.message || '登录失败，请重新登录';
    }
  },
};
</script>

<style scoped>
.callback { padding: 80px 24px; }
</style>
